/** Finding one pitch period in a sound and turning it into a single-cycle waveform. */
import { framesOf, mixDown, normalizeRange, readInterpolated, removeDcRange, type PcmData } from './sampleEdit'
import { CYCLE_PEAK } from './waveGen'

export interface PeriodEstimate {
  /** Period length in (fractional) frames. */
  period: number
  frequency: number
  /** 0..1, how periodic the sound is at that period. */
  clarity: number
}

const MAX_WINDOW = 8192
const YIN_THRESHOLD = 0.15

/** YIN pitch-period estimate over `[start, end)` of a mono signal; null for unpitched sound. */
export function detectPeriod(
  mono: Float32Array, start: number, end: number, sampleRate: number, minHz = 20, maxHz = 5000,
): PeriodEstimate | null {
  const a = Math.max(0, start)
  const len = Math.min(mono.length, end) - a
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), Math.floor(len / 2))
  if (maxLag <= minLag + 2) return null
  const w = Math.min(MAX_WINDOW, len - maxLag)

  const cmnd = new Float32Array(maxLag + 2)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let d = 0
    for (let j = 0; j < w; j++) {
      const diff = mono[a + j] - mono[a + j + tau]
      d += diff * diff
    }
    running += d
    cmnd[tau] = running === 0 ? 1 : (d * tau) / running
  }

  let tau = -1
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) {
    let best = minLag
    for (let t = minLag; t <= maxLag; t++) if (cmnd[t] < cmnd[best]) best = t
    if (cmnd[best] > 0.4) return null
    tau = best
  }

  // Parabolic refinement between the neighbouring lags.
  const [y0, y1, y2] = [cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]]
  const denom = y0 - 2 * y1 + y2
  const period = denom > 0 ? tau + (y0 - y2) / (2 * denom) : tau
  return { period, frequency: sampleRate / period, clarity: Math.max(0, Math.min(1, 1 - y1)) }
}

/** The period found in a selection of (possibly stereo) audio. */
export function detectPeriodIn(data: PcmData, start: number, end: number, sampleRate: number): PeriodEstimate | null {
  return detectPeriod(mixDown(data), start, end, sampleRate)
}

export interface CycleOptions {
  /** Output length in frames. */
  length: number
  /** Period in frames; without one the whole range is taken as one cycle. */
  period?: number
  /** Average every whole period in the range, which smooths noise and movement. */
  average?: boolean
}

/**
 * One cycle from `[start, end)`, resampled to `length` frames, DC-free, normalized and rotated
 * to start on a rising zero crossing. Each period is read band-limited.
 */
export function extractCycle(data: PcmData, start: number, end: number, opts: CycleOptions): PcmData {
  const frames = framesOf(data)
  const a = Math.max(0, Math.min(start, end))
  const b = Math.min(frames, Math.max(start, end))
  const s0 = a
  let period = b - a
  let count = 1
  if (opts.period && opts.period >= 2) {
    period = opts.period
    count = opts.average ? Math.max(1, Math.floor((b - s0) / period)) : 1
  }
  const length = Math.max(2, Math.round(opts.length))
  const step = period / length
  const cycle = data.map((ch) => {
    const sum = new Float32Array(length)
    for (let m = 0; m < count; m++) {
      const from = s0 + m * period
      const one = readInterpolated(ch, length, (i) => from + i * step, step)
      for (let i = 0; i < length; i++) sum[i] += one[i] / count
    }
    return sum
  })
  return rotateToZeroCrossing(normalizeRange(removeDcRange(cycle, 0, length), 0, length, CYCLE_PEAK))
}

/** Rotates a cycle so it starts on its first rising zero crossing (read on the mono mix). */
function rotateToZeroCrossing(cycle: PcmData): PcmData {
  const mono = mixDown(cycle)
  const n = mono.length
  let at = 0
  for (let i = 0; i < n; i++) {
    if (mono[(i + n - 1) % n] < 0 && mono[i] >= 0) { at = i; break }
  }
  if (at === 0) return cycle
  return cycle.map((ch) => {
    const out = new Float32Array(n)
    out.set(ch.subarray(at), 0)
    out.set(ch.subarray(0, at), n - at)
    return out
  })
}

/** Repeats a cycle at `period` frames per cycle for `frames` frames, to audition it at pitch. */
export function loopCycle(cycle: PcmData, period: number, frames: number): PcmData {
  const n = framesOf(cycle)
  const step = n / period
  return cycle.map((ch) => readInterpolated(ch, frames, (i) => (i * step) % n, step, true))
}

/**
 * A wavetable: `frames` cycles taken from evenly spaced windows across `[start, end)`, each
 * found and shaped like `extractCycle`, so a sweep through the table follows the sound.
 * A window without a clear pitch uses `fallbackPeriod`, or itself as one cycle; `detect: false`
 * takes every window as one cycle.
 */
export function extractWavetable(
  data: PcmData, start: number, end: number, sampleRate: number,
  opts: { length: number; frames: number; average?: boolean; fallbackPeriod?: number; detect?: boolean },
): PcmData {
  const a = Math.max(0, Math.min(start, end))
  const b = Math.min(framesOf(data), Math.max(start, end))
  const n = Math.max(1, Math.round(opts.frames))
  const window = (b - a) / n
  const cycles = Array.from({ length: n }, (_, k) => {
    const from = Math.round(a + k * window)
    const to = Math.round(a + (k + 1) * window)
    const period = opts.detect === false ? undefined : detectPeriodIn(data, from, to, sampleRate)?.period ?? opts.fallbackPeriod
    return extractCycle(data, from, to, { length: opts.length, period, average: opts.average })
  })
  return data.map((_, c) => {
    const out = new Float32Array(n * opts.length)
    cycles.forEach((cycle, k) => out.set(cycle[c], k * opts.length))
    return out
  })
}

/** Plays each wavetable frame in turn, looped at `period` frames per cycle, `frames` frames in all. */
export function sweepWavetable(table: PcmData, cycleLength: number, period: number, frames: number): PcmData {
  const count = Math.max(1, Math.floor(framesOf(table) / cycleLength))
  const per = Math.max(1, Math.floor(frames / count))
  return table.map((ch) => {
    const out = new Float32Array(per * count)
    for (let k = 0; k < count; k++) {
      const frame = [ch.subarray(k * cycleLength, (k + 1) * cycleLength)] as PcmData
      out.set(loopCycle(frame, period, per)[0], k * per)
    }
    return out
  })
}
