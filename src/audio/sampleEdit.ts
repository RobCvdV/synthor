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
