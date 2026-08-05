/**
 * Main-thread wrapper for the Scheduler AudioWorklet.
 *
 * Owns the AudioWorkletNode, handles module registration, and provides
 * a clean API for useEngine: play/stop/update/tempo/panic.
 *
 * The worklet outputs control signals (gate, freq per track) on its audio
 * channels. Connect this node to Elementary's input to feed el.in nodes.
 *
 * Module loading: Vite resolves `new URL(..., import.meta.url)` at build
 * time. The processor is self-contained (no project imports) because it
 * runs in the AudioWorkletGlobalScope.
 */

import type { PlaybackData, TrackPlaybackData } from './playbackData'

/** Structured-cloneable command sent to the worklet. */
interface SchedulerCommand {
  type: 'play' | 'stop' | 'set-bpm' | 'update' | 'panic'
  sessionId: number
  tracks?: SerializableTrack[]
  totalRows?: number
  rowsPerSec?: number
  startRow?: number
  bpm?: number
  linesPerBeat?: number
}

/** Lightweight track data for postMessage (no unused fields). */
interface SerializableTrack {
  gate: number[]
  freq: number[]
  vol: number[]
  slotGates?: Record<string, number[]>
  channelOffset: number
  channelCount: number
}

export class SchedulerNode {
  readonly node: AudioWorkletNode
  private sessionId = 0

  /** Fired on each 'row' event from the worklet (for UI playhead). */
  onRow: ((row: number) => void) | null = null
  /** Fired when playback loops past totalRows. */
  onLoop: (() => void) | null = null

  private constructor(node: AudioWorkletNode) {
    this.node = node
    node.port.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (!msg || msg.sessionId !== this.sessionId) return
      if (msg.type === 'row') {
        this.onRow?.(msg.row)
      } else if (msg.type === 'loop') {
        this.onLoop?.()
      }
    }
  }

  /** Create and register the scheduler worklet. Call once per AudioContext. */
  static async create(ctx: AudioContext): Promise<SchedulerNode> {
    // Register the worklet processor module.
    // In Vite, new URL with a static path resolves at build time and
    // emits the file as a separate chunk. The ?worker suffix isn't needed;
    // Vite supports new URL for any asset type.
    const moduleUrl = new URL(
      './scheduler-processor.ts',
      import.meta.url,
    ).href
    await ctx.audioWorklet.addModule(moduleUrl)

    const node = new AudioWorkletNode(ctx, 'scheduler-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [32], // max channels per spec
    })

    return new SchedulerNode(node)
  }

  /** Number of audio output channels. Set before first play. */
  set channelCount(n: number) {
    // Re-create the node with the right output channel count if needed.
    // Actually, the AudioWorkletNode channelCount is fixed at construction.
    // We use 32 max and only write to the first N channels.
    void n
  }

  /** Start playback. */
  play(data: PlaybackData, bpm: number, linesPerBeat: number, startRow = 0): void {
    this.sessionId++
    const rowsPerSec = (bpm / 60) * linesPerBeat
    this.node.port.postMessage({
      type: 'play',
      sessionId: this.sessionId,
      tracks: serializeTracks(data.tracks),
      totalRows: data.totalRows,
      rowsPerSec,
      startRow,
    } satisfies SchedulerCommand)
  }

  /** Stop playback immediately. */
  stop(): void {
    this.node.port.postMessage({
      type: 'stop',
      sessionId: this.sessionId,
    } satisfies SchedulerCommand)
  }

  /** Update playback data (notes edited while playing). */
  update(data: PlaybackData): void {
    this.node.port.postMessage({
      type: 'update',
      sessionId: this.sessionId,
      tracks: serializeTracks(data.tracks),
      totalRows: data.totalRows,
    } satisfies SchedulerCommand)
  }

  /** Change tempo without restarting. */
  setTempo(bpm: number, linesPerBeat: number): void {
    const rowsPerSec = (bpm / 60) * linesPerBeat
    this.node.port.postMessage({
      type: 'set-bpm',
      sessionId: this.sessionId,
      rowsPerSec,
    } satisfies SchedulerCommand)
  }

  /** Kill all sound immediately. */
  panic(): void {
    this.node.port.postMessage({
      type: 'panic',
      sessionId: this.sessionId,
    } satisfies SchedulerCommand)
  }

  /** Connect this node's output to a destination (Elementary's input). */
  connect(dest: AudioNode): void {
    this.node.connect(dest)
  }

  /** Disconnect from the graph. */
  disconnect(): void {
    this.node.disconnect()
  }
}

/** Strip TrackPlaybackData down to structured-cloneable arrays. */
function serializeTracks(
  tracks: readonly TrackPlaybackData[],
): SerializableTrack[] {
  return tracks.map((t) => ({
    gate: t.gate,
    freq: t.freq,
    vol: t.vol,
    slotGates: t.slotGates,
    channelOffset: t.channelOffset,
    channelCount: t.slotGates
      ? Object.keys(t.slotGates).length
      : 2,
  }))
}
