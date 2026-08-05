/**
 * Scheduler AudioWorklet Processor — runs on the audio rendering thread.
 *
 * Receives playback data (per-track gate/freq arrays) via the message port,
 * maintains a sample-accurate clock, and outputs control signals on audio
 * channels that feed into Elementary's el.in nodes.
 *
 * This processor is intentionally self-contained because it runs in the
 * AudioWorkletGlobalScope — a separate JS context from the main thread.
 *
 * Type declarations below mirror the AudioWorklet global scope; they're
 * only needed for type-checking (the worklet has its own global types).
 */

// ── AudioWorklet global type declarations ────────────────────────────
// These mirror the AudioWorkletGlobalScope types for TypeScript checking.
// The actual types are provided by the worklet runtime (not the DOM lib).
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(_options?: AudioWorkletNodeOptions)
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}
interface AudioWorkletNodeOptions {
  numberOfInputs?: number
  numberOfOutputs?: number
  outputChannelCount?: number[]
  parameterData?: Record<string, number>
  processorOptions?: any
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void

/** Commands sent from the main thread via port.postMessage. */
interface SchedulerCommand {
  type: 'play' | 'stop' | 'set-bpm' | 'update' | 'panic'
  sessionId: number
  /** Playback data (for 'play' and 'update'). */
  tracks?: {
    gate: number[]
    freq: number[]
    vol: number[]
    slotGates?: Record<string, number[]>
    channelOffset: number
    /** Number of channels this track occupies (2 for regular, 1+slots for drumkit). */
    channelCount: number
  }[]
  totalRows?: number
  rowsPerSec?: number
  startRow?: number
  bpm?: number
  linesPerBeat?: number
}

/** Channel layout sent back to main thread after 'play'. */
interface ChannelLayout {
  trackId: string
  instId: string
  channelOffset: number
  channelCount: number
}

// ── Processor State ────────────────────────────────────────────────

/** The render quantum size in samples (Web Audio spec). */
const BLOCK_SIZE = 128

/** Rows per beat for the 16th-note grid. */
const LINES_PER_BEAT = 4

let sampleRate = 44100

/** Current session — incremented on each play, used to reject stale commands. */
let sessionId = 0

/** Whether playback is active. */
let playing = false

/** Current fractional row position. */
let currentRow = 0

/** Rows advanced per second. */
let rowsPerSec = (120 / 60) * LINES_PER_BEAT // default 120 BPM

/** Track control data (active during playback). */
interface TrackData {
  gate: number[]
  freq: number[]
  vol: number[]
  slotGates?: Record<string, number[]>
  channelOffset: number
  channelCount: number
}
let tracks: TrackData[] = []

/** Total rows in the current arrangement. */
let totalRows = 64

/** Start row for play-from-cursor. */
let startRow = 0

// ── Audio Worklet Processor ─────────────────────────────────────────

class SchedulerProcessor extends AudioWorkletProcessor {
  constructor(_options?: AudioWorkletNodeOptions) {
    super()
    sampleRate = (globalThis as unknown as { sampleRate: number }).sampleRate

    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as SchedulerCommand
      // Reject commands from stale sessions.
      if (msg.sessionId !== 0 && msg.sessionId !== sessionId) return

      switch (msg.type) {
        case 'play': {
          sessionId = msg.sessionId
          playing = true
          if (msg.tracks) {
            tracks = msg.tracks as TrackData[]
          }
          if (msg.rowsPerSec !== undefined) {
            rowsPerSec = msg.rowsPerSec
          }
          if (msg.totalRows !== undefined) {
            totalRows = msg.totalRows
          }
          startRow = msg.startRow ?? 0
          currentRow = startRow
          break
        }
        case 'stop': {
          playing = false
          currentRow = 0
          // Zero all gates so instruments stop sounding.
          for (const t of tracks) {
            for (let ch = 0; ch < t.channelCount; ch++) {
              // Gate channels are the first in each track's block.
              // We'll zero them in the output zeroing.
            }
          }
          break
        }
        case 'set-bpm': {
          if (msg.rowsPerSec !== undefined) {
            rowsPerSec = msg.rowsPerSec
          }
          break
        }
        case 'update': {
          // Update playback data without stopping.
          if (msg.tracks) {
            tracks = msg.tracks as TrackData[]
          }
          if (msg.totalRows !== undefined) {
            totalRows = msg.totalRows
          }
          break
        }
        case 'panic': {
          playing = false
          currentRow = 0
          tracks = []
          break
        }
      }
    }
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    // Zero all output channels first.
    const out = outputs[0]
    if (!out) return true
    for (let ch = 0; ch < out.length; ch++) {
      out[ch].fill(0)
    }

    if (!playing || tracks.length === 0) return true

    // Advance the row position.
    const rowsPerSample = rowsPerSec / sampleRate
    const rowsPerBlock = rowsPerSample * BLOCK_SIZE

    // Determine the integer row for this block.
    // We use floor so the value is constant for the entire block.
    const row = Math.floor(currentRow)

    // Wrap around at totalRows (loop).
    const wrappedRow = totalRows > 0
      ? ((row % totalRows) + totalRows) % totalRows
      : row

    // Output gate/freq for each track at the current row.
    for (const t of tracks) {
      const gate = t.gate[wrappedRow] ?? 0
      const freq = t.freq[wrappedRow] ?? 0

      // Channel layout: [gate, freq] for regular tracks.
      // For drumkit: [slot0_gate, slot1_gate, ...]
      const base = t.channelOffset
      if (t.slotGates) {
        // Drumkit: output per-slot gates. Freq is set per slot by the
        // drumkit instrument's note assignment (not controlled here).
        let ci = 0
        for (const _key of Object.keys(t.slotGates)) {
          if (base + ci < out.length) {
            out[base + ci].fill(t.slotGates[_key]?.[wrappedRow] ?? 0)
          }
          ci++
        }
      } else {
        // Osc/modular: gate on first channel, freq on second.
        if (base < out.length) out[base].fill(gate)
        if (base + 1 < out.length) out[base + 1].fill(freq)
      }
    }

    // Report current row back to main thread for UI.
    this.port.postMessage({ type: 'row', row: wrappedRow, sessionId })

    currentRow += rowsPerBlock

    // Handle loop detection: if we wrapped around, notify main thread.
    if (totalRows > 0 && currentRow >= totalRows) {
      currentRow -= totalRows
      this.port.postMessage({ type: 'loop', sessionId })
    }

    // Keep the processor alive.
    return true
  }
}

registerProcessor('scheduler-processor', SchedulerProcessor)
