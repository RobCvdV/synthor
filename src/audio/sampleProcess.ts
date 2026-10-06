/**
 * Pure sound-shaping processors over `[start, end)` of PCM data, used by the editor's live
 * processes. Like `sampleEdit`, inputs are never mutated and the channel count is kept.
 */
import { framesOf, type PcmData } from './sampleEdit'

function clampRange(start: number, end: number, frames: number): [number, number] {
  return [Math.max(0, Math.min(frames, start)), Math.max(0, Math.min(frames, end))]
}

/** Copies every channel and runs `fn` over the copy's `[a, b)` in place. */
function processChannels(data: PcmData, start: number, end: number, fn: (seg: Float32Array) => void): PcmData {
  const [a, b] = clampRange(start, end, framesOf(data))
  if (b <= a) return data
  return data.map((ch) => {
    const out = new Float32Array(ch)
    fn(out.subarray(a, b))
    return out
  })
}

/** One one-pole pass over `seg`, forwards or backwards, starting from `state`; returns the end state. */
function onePole(seg: Float32Array, k: number, state: number, backward: boolean): number {
  const n = seg.length
  let y = state
  for (let j = 0; j < n; j++) {
    const i = backward ? n - 1 - j : j
    y += k * (seg[i] - y)
    seg[i] = y
  }
  return y
}

/** The state a pass would carry around a loop of `seg`, by running it repeatedly on a scratch copy. */
function circularState(seg: Float32Array, k: number, backward: boolean, rounds: number): number {
  const scratch = new Float32Array(seg.length)
  let y = backward ? seg[0] : seg[seg.length - 1]
  for (let r = 0; r < rounds; r++) {
    scratch.set(seg)
    y = onePole(scratch, k, y, backward)
  }
  return y
}

/**
 * Low-passes `[start, end)` with a zero-phase filter (two one-pole passes each way), so edges
 * soften without the waveform shifting in time. `cutoff` is in cycles per frame (0.5 = Nyquist).
 * With `period`, the range is a run of single cycles: each one is filtered as a loop.
 */
export function smoothRange(data: PcmData, start: number, end: number, cutoff: number, period?: number): PcmData {
  if (cutoff >= 0.5) return data
  const k = 1 - Math.exp(-2 * Math.PI * Math.max(1e-5, cutoff))
  const filter = (seg: Float32Array, loop: boolean) => {
    // Enough loops for the filter memory to settle; a slow filter outlasts one cycle.
    const rounds = Math.min(64, Math.ceil(4 / k / seg.length) + 1)
    for (const backward of [false, true, false, true]) {
      const state = loop ? circularState(seg, k, backward, rounds) : backward ? seg[seg.length - 1] : seg[0]
      onePole(seg, k, state, backward)
    }
  }
  return processChannels(data, start, end, (seg) => {
    if (!period || period < 2 || seg.length % period !== 0) return filter(seg, false)
    for (let p = 0; p < seg.length; p += period) filter(seg.subarray(p, p + period), true)
  })
}

/** Soft-clips `[start, end)` through tanh at `gain`, scaled so full scale stays full scale. */
export function driveRange(data: PcmData, start: number, end: number, gain: number): PcmData {
  if (gain <= 0) return data
  const norm = 1 / Math.tanh(gain)
  return processChannels(data, start, end, (seg) => {
    for (let i = 0; i < seg.length; i++) seg[i] = Math.tanh(seg[i] * gain) * norm
  })
}

/** Quantizes `[start, end)` to `bits` and holds every `hold`-th frame, lo-fi style. */
export function crushRange(data: PcmData, start: number, end: number, bits: number, hold: number): PcmData {
  const levels = Math.pow(2, Math.max(1, bits) - 1)
  const every = Math.max(1, Math.round(hold))
  return processChannels(data, start, end, (seg) => {
    let held = 0
    for (let i = 0; i < seg.length; i++) {
      if (i % every === 0) held = Math.max(-1, Math.min(1, Math.round(seg[i] * levels) / levels))
      seg[i] = held
    }
  })
}
