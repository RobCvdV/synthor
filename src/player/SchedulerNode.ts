/**
 * Main-thread wrapper for the Scheduler AudioWorklet.
 *
 * The processor runs on the audio rendering thread. It receives playback
 * data via postMessage, maintains a block-quantized clock, and outputs
 * gate/freq control signals per track on its audio output channels.
 *
 * The processor code is inlined as a Blob URL (same approach Elementary
 * uses for its worklet) — this bypasses Vite module transforms entirely
 * and is guaranteed to work in the AudioWorkletGlobalScope.
 */

import type { PlaybackData, TrackPlaybackData } from './playbackData'

// ── Inlined processor code ──────────────────────────────────────────
// Keep in sync with scheduler-processor.ts (which exists for type-checking).
const PROCESSOR_CODE = `
const BLOCK_SIZE = 128;
let sampleRate = 44100;
let sessionId = 0;
let playing = false;
let currentRow = 0;
let rowsPerSec = 8; // default 120 BPM, 4 lines/beat
let tracks = [];
let totalRows = 64;
let startRow = 0;

class SchedulerProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super(opts);
    sampleRate = globalThis.sampleRate;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type !== 'play' && msg.type !== 'stop' && msg.type !== 'panic') {
        if (msg.sessionId && msg.sessionId !== sessionId) return;
      }
      switch (msg.type) {
        case 'play':
          sessionId = msg.sessionId;
          playing = true;
          if (msg.tracks) tracks = msg.tracks;
          if (msg.rowsPerSec != null) rowsPerSec = msg.rowsPerSec;
          if (msg.totalRows != null) totalRows = msg.totalRows;
          startRow = msg.startRow || 0;
          currentRow = startRow;
          break;
        case 'stop':
          playing = false;
          currentRow = 0;
          break;
        case 'set-bpm':
          if (msg.rowsPerSec != null) rowsPerSec = msg.rowsPerSec;
          break;
        case 'update':
          if (msg.tracks) tracks = msg.tracks;
          if (msg.totalRows != null) totalRows = msg.totalRows;
          break;
        case 'panic':
          playing = false;
          currentRow = 0;
          tracks = [];
          break;
      }
    };
  }

  process(_inputs, outputs, _parameters) {
    const out = outputs[0];
    if (!out) return true;
    for (let ch = 0; ch < out.length; ch++) out[ch].fill(0);
    if (!playing || tracks.length === 0) return true;

    const rowsPerSample = rowsPerSec / sampleRate;
    const rowsPerBlock = rowsPerSample * BLOCK_SIZE;
    const row = Math.floor(currentRow);
    const wrappedRow = totalRows > 0 ? ((row % totalRows) + totalRows) % totalRows : row;

    for (const t of tracks) {
      const gate = t.gate[wrappedRow] != null ? t.gate[wrappedRow] : 0;
      const freq = t.freq[wrappedRow] != null ? t.freq[wrappedRow] : 0;
      const base = t.channelOffset;
      if (t.slotGates) {
        const keys = Object.keys(t.slotGates);
        for (let ci = 0; ci < keys.length; ci++) {
          if (base + ci < out.length) {
            const sg = t.slotGates[keys[ci]];
            out[base + ci].fill(sg && sg[wrappedRow] != null ? sg[wrappedRow] : 0);
          }
        }
      } else {
        if (base < out.length) out[base].fill(gate);
        if (base + 1 < out.length) out[base + 1].fill(freq);
      }
    }

    this.port.postMessage({ type: 'row', row: wrappedRow, sessionId });
    currentRow += rowsPerBlock;
    if (totalRows > 0 && currentRow >= totalRows) {
      currentRow -= totalRows;
      this.port.postMessage({ type: 'loop', sessionId });
    }
    return true;
  }
}
registerProcessor('scheduler-processor', SchedulerProcessor);
`

/** Structured-cloneable command sent to the worklet. */
interface SchedulerCommand {
  type: 'play' | 'stop' | 'set-bpm' | 'update' | 'panic'
  sessionId: number
  tracks?: SerializableTrack[]
  totalRows?: number
  rowsPerSec?: number
  startRow?: number
}

interface SerializableTrack {
  gate: number[]
  freq: number[]
  vol: number[]
  slotGates?: Record<string, number[]>
  channelOffset: number
  channelCount: number
}

// ── Module cache (one per AudioContext, like Elementary) ──────────────
let moduleLoaded = false

export class SchedulerNode {
  readonly node: AudioWorkletNode
  private sessionId = 0

  onRow: ((row: number) => void) | null = null
  onLoop: (() => void) | null = null

  private constructor(node: AudioWorkletNode) {
    this.node = node
    node.port.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (!msg || msg.sessionId !== this.sessionId) return
      if (msg.type === 'row') this.onRow?.(msg.row)
      else if (msg.type === 'loop') this.onLoop?.()
    }
  }

  /** Create and register the scheduler worklet. Call once per AudioContext. */
  static async create(ctx: AudioContext): Promise<SchedulerNode> {
    if (!moduleLoaded) {
      const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      moduleLoaded = true
    }

    const node = new AudioWorkletNode(ctx, 'scheduler-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [32],
    })

    return new SchedulerNode(node)
  }

  play(data: PlaybackData, bpm: number, linesPerBeat: number, startRow = 0): void {
    this.sessionId++
    this.node.port.postMessage({
      type: 'play',
      sessionId: this.sessionId,
      tracks: serializeTracks(data.tracks),
      totalRows: data.totalRows,
      rowsPerSec: (bpm / 60) * linesPerBeat,
      startRow,
    } satisfies SchedulerCommand)
  }

  stop(): void {
    this.node.port.postMessage({
      type: 'stop',
      sessionId: this.sessionId,
    } satisfies SchedulerCommand)
  }

  update(data: PlaybackData): void {
    this.node.port.postMessage({
      type: 'update',
      sessionId: this.sessionId,
      tracks: serializeTracks(data.tracks),
      totalRows: data.totalRows,
    } satisfies SchedulerCommand)
  }

  setTempo(bpm: number, linesPerBeat: number): void {
    this.node.port.postMessage({
      type: 'set-bpm',
      sessionId: this.sessionId,
      rowsPerSec: (bpm / 60) * linesPerBeat,
    } satisfies SchedulerCommand)
  }

  panic(): void {
    this.node.port.postMessage({
      type: 'panic',
      sessionId: this.sessionId,
    } satisfies SchedulerCommand)
  }

  connect(dest: AudioNode): void { this.node.connect(dest) }
  disconnect(): void { this.node.disconnect() }
}

function serializeTracks(
  tracks: readonly TrackPlaybackData[],
): SerializableTrack[] {
  return tracks.map((t) => ({
    gate: t.gate,
    freq: t.freq,
    vol: t.vol,
    slotGates: t.slotGates,
    channelOffset: t.channelOffset,
    channelCount: t.slotGates ? Object.keys(t.slotGates).length : 2,
  }))
}
