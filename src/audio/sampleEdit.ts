/**
 * Pure sample-editing operations on PCM data (`Float32Array[]`: mono = [ch0],
 * stereo = [L, R]). All ranges are `[start, end)` in frames, clamped to the
 * sample bounds. All ops are pure — inputs are never mutated — and always
 * preserve the target's channel count.
 *
 * Shrinking ops never produce a fully empty sample: 1 silent frame is the
 * minimum (a zero-byte WAV data chunk breaks some decoders).
 */

export type PcmData = Float32Array<ArrayBuffer>[]

/** Frame count (length of the first channel; all channels share it). */
export function framesOf(data: PcmData): number {
  return data[0]?.length ?? 0
}

/** Clamp `[start, end)` to `[0, frames]`, normalizing to `start <= end`. */
function clampRange(start: number, end: number, frames: number): [number, number] {
  const a = Math.max(0, Math.min(frames, Math.min(start, end)))
  const b = Math.max(0, Math.min(frames, Math.max(start, end)))
  return [a, b]
}

/** At least 1 silent frame — the "empty" sample. */
function silentMinimum(data: PcmData): PcmData {
  return data.map(() => new Float32Array(1))
}

function mapChannels(
  data: PcmData,
  fn: (ch: Float32Array<ArrayBuffer>, index: number) => Float32Array<ArrayBuffer>,
): PcmData {
  return data.map(fn)
}

/** Adapt a paste-buffer to the target's channel count. */
export function adaptChannels(pb: PcmData, channels: number): PcmData {
  if (pb.length === 0) return []
  if (pb.length === channels) return pb
  if (channels === 2 && pb.length === 1) return [pb[0], new Float32Array(pb[0])] // duplicate mono
  if (channels === 1 && pb.length >= 2) {
    // Half-sum mixdown: never clips, keeps relative balance.
    const mixed = new Float32Array(pb[0].length)
    for (let i = 0; i < mixed.length; i++) mixed[i] = (pb[0][i] + pb[1][i]) * 0.5
    return [mixed]
  }
  throw new Error(`Cannot adapt ${pb.length} channels to ${channels}`)
}

/** Copy `[start, end)` into a new PcmData of the same channel count. */
export function copyRange(data: PcmData, start: number, end: number): PcmData {
  const [a, b] = clampRange(start, end, framesOf(data))
  return mapChannels(data, (ch) => ch.slice(a, b))
}

/** Remove `[start, end)` — returns the remainder and the removed portion. */
export function cutRange(data: PcmData, start: number, end: number): { data: PcmData; removed: PcmData } {
  const frames = framesOf(data)
  const [a, b] = clampRange(start, end, frames)
  if (b <= a) return { data, removed: mapChannels(data, () => new Float32Array(0)) }
  const removed = copyRange(data, a, b)
  const rest = mapChannels(data, (ch) => {
    const out = new Float32Array(frames - (b - a))
    out.set(ch.subarray(0, a), 0)
    out.set(ch.subarray(b), a)
    return out
  })
  return { data: rest.length === 0 || framesOf(rest) === 0 ? silentMinimum(data) : rest, removed }
}

/** Insert PB at `at`, shifting existing content right. Always grows. */
export function insertAt(data: PcmData, at: number, pb: PcmData): PcmData {
  const frames = framesOf(data)
  const a = Math.max(0, Math.min(frames, at))
  const pbData = adaptChannels(pb, data.length)
  const pbFrames = framesOf(pbData)
  if (pbFrames === 0) return data
  return mapChannels(data, (ch, c) => {
    const out = new Float32Array(frames + pbFrames)
    out.set(ch.subarray(0, a), 0)
    out.set(pbData[c], a)
    out.set(ch.subarray(a), a + pbFrames)
    return out
  })
}

/** Overwrite `[at, at+pbFrames)` with PB, extending the sample if needed. */
export function pasteAt(data: PcmData, at: number, pb: PcmData): PcmData {
  const frames = framesOf(data)
  const a = Math.max(0, Math.min(frames, at))
  const pbData = adaptChannels(pb, data.length)
  const pbFrames = framesOf(pbData)
  if (pbFrames === 0) return data
  const newFrames = Math.max(frames, a + pbFrames)
  return mapChannels(data, (ch, c) => {
    const out = new Float32Array(newFrames)
    out.set(ch.subarray(0, a), 0)
    out.set(pbData[c], a)
    out.set(ch.subarray(Math.min(a + pbFrames, frames)), a + pbFrames)
    return out
  })
}

/** Cut out `[start, end)` and insert PB in its place. */
export function replaceRange(data: PcmData, start: number, end: number, pb: PcmData): PcmData {
  const frames = framesOf(data)
  const [a, b] = clampRange(start, end, frames)
  const pbData = adaptChannels(pb, data.length)
  const pbFrames = framesOf(pbData)
  if (pbFrames === 0) return cutRange(data, a, b).data
  const newFrames = frames - (b - a) + pbFrames
  if (newFrames <= 0) return silentMinimum(data)
  return mapChannels(data, (ch, c) => {
    const out = new Float32Array(newFrames)
    out.set(ch.subarray(0, a), 0)
    out.set(pbData[c], a)
    out.set(ch.subarray(b), a + pbFrames)
    return out
  })
}

/** Reverse the samples within `[start, end)` (sounds backwards). */
export function reverseRange(data: PcmData, start: number, end: number): PcmData {
  const frames = framesOf(data)
  const [a, b] = clampRange(start, end, frames)
  if (b <= a) return data
  return mapChannels(data, (ch) => {
    const out = new Float32Array(ch)
    for (let i = a, j = b - 1; i < b; i++, j--) out[i] = ch[j]
    return out
  })
}

/** Scale `[start, end)` by a linear gain, clamped to [-1, 1]. */
export function gainRange(data: PcmData, start: number, end: number, gain: number): PcmData {
  const frames = framesOf(data)
  const [a, b] = clampRange(start, end, frames)
  if (b <= a) return data
  return mapChannels(data, (ch) => {
    const out = new Float32Array(ch)
    for (let i = a; i < b; i++) out[i] = Math.max(-1, Math.min(1, ch[i] * gain))
    return out
  })
}

/** Linear fade over `[start, end)` from gain `from` to gain `to`. */
export function fadeRange(data: PcmData, start: number, end: number, from: number, to: number): PcmData {
  const frames = framesOf(data)
  const [a, b] = clampRange(start, end, frames)
  const len = b - a
  if (len <= 0) return data
  return mapChannels(data, (ch) => {
    const out = new Float32Array(ch)
    for (let i = a; i < b; i++) {
      const t = len === 1 ? 0 : (i - a) / (len - 1)
      const g = from + (to - from) * t
      out[i] = Math.max(-1, Math.min(1, ch[i] * g))
    }
    return out
  })
}

/** Keep only `[start, end)`. */
export function trimToRange(data: PcmData, start: number, end: number): PcmData {
  const out = copyRange(data, start, end)
  return framesOf(out) === 0 ? silentMinimum(data) : out
}

export function silenceRange(data: PcmData, start: number, end: number): PcmData {
  return gainRange(data, start, end, 0)
}

/** Scale `[start, end)` so its loudest frame (over all channels) peaks at `peak`. */
export function normalizeRange(data: PcmData, start: number, end: number, peak = 1): PcmData {
  const [a, b] = clampRange(start, end, framesOf(data))
  let max = 0
  for (const ch of data) for (let i = a; i < b; i++) max = Math.max(max, Math.abs(ch[i]))
  return max === 0 ? data : gainRange(data, a, b, peak / max)
}

/** Subtract each channel's average over `[start, end)`. */
export function removeDcRange(data: PcmData, start: number, end: number): PcmData {
  const [a, b] = clampRange(start, end, framesOf(data))
  if (b <= a) return data
  return mapChannels(data, (ch) => {
    let sum = 0
    for (let i = a; i < b; i++) sum += ch[i]
    const mean = sum / (b - a)
    const out = new Float32Array(ch)
    for (let i = a; i < b; i++) out[i] = Math.max(-1, Math.min(1, ch[i] - mean))
    return out
  })
}

/** Mono view of the audio (channel average), for analysis. */
export function mixDown(data: PcmData): Float32Array {
  if (data.length === 1) return data[0]
  return adaptChannels(data, 1)[0]
}

/**
 * The rising zero crossing nearest to `frame` (within `radius`), judged on the mono mix;
 * `frame` itself when there is none.
 */
export function nearestZeroCrossing(data: PcmData, frame: number, radius = 2048): number {
  const mono = mixDown(data)
  const n = mono.length
  const rising = (i: number) => i > 0 && i < n && mono[i - 1] < 0 && mono[i] >= 0
  if (frame <= 0 || frame >= n) return Math.max(0, Math.min(n, frame))
  for (let d = 0; d <= radius; d++) {
    if (rising(frame - d)) return frame - d
    if (rising(frame + d)) return frame + d
  }
  return frame
}

const SINC_HALF_TAPS = 16

/** Blackman-windowed sinc, `x` in input samples, cutoff as a fraction of Nyquist. */
function windowedSinc(x: number, cutoff: number, halfWidth: number): number {
  if (Math.abs(x) >= halfWidth) return 0
  const w = 0.42 + 0.5 * Math.cos(Math.PI * x / halfWidth) + 0.08 * Math.cos(2 * Math.PI * x / halfWidth)
  const t = Math.PI * x * cutoff
  return cutoff * (t === 0 ? 1 : Math.sin(t) / t) * w
}

/**
 * Band-limited read of `ch` at fractional positions: `pos(i)` for output frame i, reading
 * `step` input frames per output frame (steps above 1 low-pass against aliasing).
 * `periodic` wraps reads around the ends, for single cycles.
 */
export function readInterpolated(
  ch: Float32Array, frames: number, pos: (i: number) => number, step: number, periodic = false,
): Float32Array<ArrayBuffer> {
  const n = ch.length
  const cutoff = Math.min(1, 1 / step)
  const half = SINC_HALF_TAPS / cutoff
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    const p = pos(i)
    const lo = Math.ceil(p - half)
    const hi = Math.floor(p + half)
    let acc = 0
    for (let j = lo; j <= hi; j++) {
      const k = periodic ? ((j % n) + n) % n : j
      if (k < 0 || k >= n) continue
      acc += ch[k] * windowedSinc(p - j, cutoff, half)
    }
    out[i] = acc
  }
  return out
}

/** Stretch or shrink the whole sample to `frames` frames (pitch changes with length). */
export function resampleTo(data: PcmData, frames: number, periodic = false): PcmData {
  const from = framesOf(data)
  const to = Math.max(1, Math.round(frames))
  if (from === 0 || to === from) return data
  const step = from / to
  return mapChannels(data, (ch) => readInterpolated(ch, to, (i) => i * step, step, periodic))
}

/** Resample `[start, end)` by `semitones` (up = shorter), keeping the rest. */
export function repitchRange(data: PcmData, start: number, end: number, semitones: number): PcmData {
  const [a, b] = clampRange(start, end, framesOf(data))
  if (b <= a || semitones === 0) return data
  const part = resampleTo(copyRange(data, a, b), (b - a) / Math.pow(2, semitones / 12))
  return replaceRange(data, a, b, part)
}

/** Draws a straight line from (f0, v0) to (f1, v1) into `ch`, in place, clamped to [-1, 1]. */
export function drawLine(ch: Float32Array, f0: number, v0: number, f1: number, v1: number): void {
  const last = ch.length - 1
  if (last < 0) return
  const [a, va, b, vb] = f0 <= f1 ? [f0, v0, f1, v1] : [f1, v1, f0, v0]
  const from = Math.max(0, Math.round(a))
  const to = Math.min(last, Math.round(b))
  for (let i = from; i <= to; i++) {
    const t = b === a ? 1 : (i - a) / (b - a)
    ch[i] = Math.max(-1, Math.min(1, va + (vb - va) * Math.max(0, Math.min(1, t))))
  }
}
