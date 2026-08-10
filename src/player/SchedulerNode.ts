/**
 * Main-thread wrapper for the Scheduler AudioWorklet.
 *
 * The processor runs on the audio rendering thread. It receives playback
 * data via postMessage, maintains a block-quantized clock, and outputs
 * control signals per voice slot on its audio output channels.
 *
 * Each voice slot has a fixed set of channels (gate, freq, vol, effects,
 * named inlets).  `signals[i]` is the per-row value array for channel
 * `offset + i`.  The scheduler outputs `signals[i][row]` on output
 * channel `offset + i`.
 *
 * The processor code is inlined as a Blob URL (same approach Elementary
 * uses for its worklet).
 */

import type { VoiceSlotData, PlaybackData } from './playbackData'

// ── Inlined processor code ──────────────────────────────────────────
// Keep in sync with scheduler-processor.ts (which exists for type-checking).
const PROCESSOR_CODE = `
const BLOCK_SIZE = 128;

class SchedulerProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super(opts);
    this.sampleRate = globalThis.sampleRate;
    this.sessionId = 0;
    this.playing = false;
    this.currentRow = 0;
    this.rowsPerSec = 8;
    this.slots = [];
    this.totalRows = 64;
    this.startRow = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type !== 'play' && msg.type !== 'stop' && msg.type !== 'panic') {
        if (msg.sessionId && msg.sessionId !== this.sessionId) return;
      }
      switch (msg.type) {
        case 'play':
          this.sessionId = msg.sessionId;
          this.playing = true;
          if (msg.slots) {
            this.slots = msg.slots;
            // Diagnostic: log first play slots.
            this.port.postMessage({ type: 'log', text: 'play: ' + msg.slots.length + ' slots, chs: [' +
              msg.slots.map(s => s.channelOffset + '+' + s.signals.length).join(', ') + ']' });
          }
          if (msg.rowsPerSec != null) this.rowsPerSec = msg.rowsPerSec;
          if (msg.totalRows != null) this.totalRows = msg.totalRows;
          this.startRow = msg.startRow || 0;
          this.currentRow = this.startRow;
          break;
        case 'stop':
          this.playing = false;
          this.currentRow = 0;
          break;
        case 'set-bpm':
          if (msg.rowsPerSec != null) this.rowsPerSec = msg.rowsPerSec;
          break;
        case 'update':
          if (msg.slots) {
            // Diagnostic: log slot count changes.
            if (msg.slots.length !== this.slots.length) {
              this.port.postMessage({ type: 'log', text: 'update: slots ' + this.slots.length + ' -> ' + msg.slots.length });
            }
            this.slots = msg.slots;
          }
          if (msg.totalRows != null) this.totalRows = msg.totalRows;
          break;
        case 'panic':
          this.playing = false;
          this.currentRow = 0;
          this.slots = [];
          break;
      }
    };
  }

  process(_inputs, outputs, _parameters) {
    const out = outputs[0];
    if (!out) return true;

    // Zero all output channels each block.
    for (let ch = 0; ch < out.length; ch++) out[ch].fill(0);

    if (!this.playing || this.slots.length === 0) return true;

    const rowsPerSample = this.rowsPerSec / this.sampleRate;
    const rowsPerBlock = rowsPerSample * BLOCK_SIZE;
    const rowFloat = this.currentRow;
    const row = Math.floor(rowFloat);
    const wrappedRow = this.totalRows > 0 ? ((row % this.totalRows) + this.totalRows) % this.totalRows : row;
    // Fraction within the current row, 0..1.  Used for sub-row staccato gate.
    const rowFraction = rowFloat - row;

    // Each slot has a signals array where signals[i] is the value array
    // for output channel offset + i.  Channel layout:
    //   Regular: 0=gate, 1=freq, 2=vol, 3=portamento, 4=volumeSlide,
    //            5=panning, 6=vibRate, 7=vibDepth, 8=tremRate,
    //            9=tremDepth, 10=staccato, 11+ = named inlets
    //   Drumkit: 0..N-1=drum gates, N=vol, N+1=portamento, ..., N+8=staccato
    const slots = this.slots;
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const base = slot.channelOffset;
      const signals = slot.signals;
      const drumGates = slot.drumGateCount || 0;

      // Staccato index: channel 10 for regular, drumSounds+8 for drumkit.
      const staccatoIdx = drumGates > 0 ? drumGates + 8 : 10;
      const staccato = signals[staccatoIdx]
        ? (signals[staccatoIdx][wrappedRow] ?? 1)
        : 1;

      for (let ci = 0; ci < signals.length; ci++) {
        const ch = base + ci;
        if (ch >= out.length) continue;
        const arr = signals[ci];
        if (!arr) continue;
        let val = arr[wrappedRow];
        if (val == null) continue;

        // Sub-row staccato: truncate gate channels by staccato fraction.
        if (drumGates > 0) {
          // Drumkit: staccato applies to all drum gate channels.
          if (ci < drumGates && val === 1 && rowFraction >= staccato) {
            val = 0;
          }
        } else {
          // Regular: staccato applies to channel 0 (gate).
          if (ci === 0 && val === 1 && rowFraction >= staccato) {
            val = 0;
          }
        }

        out[ch].fill(val);
      }
    }

    this.port.postMessage({ type: 'row', row: wrappedRow, sessionId: this.sessionId });
    this.currentRow += rowsPerBlock;
    if (this.totalRows > 0 && this.currentRow >= this.totalRows) {
      this.currentRow -= this.totalRows;
      this.port.postMessage({ type: 'loop', sessionId: this.sessionId });
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
  slots?: SerializableSlot[]
  totalRows?: number
  rowsPerSec?: number
  startRow?: number
}

/** Structured-cloneable slot data sent to the processor.
 *  signals[i] is the per-row value array for channel offset + i.
 *  drumGateCount > 0 means drumkit: signals[0..drumGateCount-1] are
 *  drum gates, staccato is at drumGateCount + 8. */
interface SerializableSlot {
  signals: number[][]
  channelOffset: number
  drumGateCount: number
}

// ── Module cache ────────────────────────────────────────────────────
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
      if (!msg) return
      if (msg.type === 'log') { console.log('[scheduler]', msg.text); return }
      if (msg.sessionId !== this.sessionId) return
      if (msg.type === 'row') this.onRow?.(msg.row)
      else if (msg.type === 'loop') this.onLoop?.()
    }
  }

  /** Create and register the scheduler worklet. Call once per AudioContext. */
  static async create(ctx: AudioContext, channelCount = 64): Promise<SchedulerNode> {
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
      outputChannelCount: [channelCount],
    })

    return new SchedulerNode(node)
  }

  play(data: PlaybackData, bpm: number, linesPerBeat: number, startRow = 0): void {
    this.sessionId++
    const slots = serializeSlots(data.slots)
    this.node.port.postMessage({
      type: 'play',
      sessionId: this.sessionId,
      slots,
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
      slots: serializeSlots(data.slots),
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

  connect(dest: AudioNode, outputIndex = 0, inputIndex = 0): void { this.node.connect(dest, outputIndex, inputIndex) }
  disconnect(): void { this.node.disconnect() }
}

function serializeSlots(
  slots: readonly VoiceSlotData[],
): SerializableSlot[] {
  return slots.map((s) => ({
    signals: s.signals,
    channelOffset: s.channelOffset,
    drumGateCount: s.drumGateCount,
  }))
}
