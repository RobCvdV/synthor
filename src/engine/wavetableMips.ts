import { cycleLength, fitsWavetable, wavetableFrameCount } from '../domain/sampleChoices'
import type { Doc, Id } from '../domain/types'
import type { SampleMeta } from './instruments'

/**
 * Band-limited tables for the native `wtosc` node, built from a sample's cycles
 * (the wave module). Each frame (one cycle) is analysed with an FFT and
 * resynthesized once per octave: level L keeps the first 512 >> L harmonics, so
 * the node can play whichever levels stay below Nyquist at the current pitch.
 *
 * Layout — the contract with `src/native/WtOsc.h` `viewOf(data, length)`:
 * `[1 (version), frames, MIP_LEVELS, size of each level…]`, then per frame,
 * per level, `size` samples plus a guard sample (a copy of the first).
 */
export const MIP_LEVELS = 10
const MAX_HARMONICS = 512

/** Samples in level L: 4 per cycle of its highest harmonic, at least 64. */
export function mipLevelSize(level: number): number {
  return Math.max(64, 4 * (MAX_HARMONICS >> level))
}

const LEVEL_SIZES = Array.from({ length: MIP_LEVELS }, (_, l) => mipLevelSize(l))
const FRAME_STRIDE = LEVEL_SIZES.reduce((sum, n) => sum + n + 1, 0)
const HEADER = 3 + MIP_LEVELS

/** The VFS key of one channel's tables for a sample cut into `size`-frame cycles. */
export function wavetableMipKey(hash: string, size: number, channel: number): string {
  return `${hash}:wt:${Math.round(size * 1000) / 1000}:c${channel}`
}

/** Floats in a table set of `frames` frames (the upload's length). */
export function wavetableMipLength(frames: number): number {
  return HEADER + frames * FRAME_STRIDE
}

/**
 * Tables for one channel, cut into cycles of `size` frames (fractional sizes
 * are fine: a resampled sample's cycles don't land on whole frames). DC is
 * kept, so the levels sound like the raw cycle, minus what would alias.
 */
export function buildWavetableMips(channel: Float32Array, size: number): Float32Array {
  const frames = wavetableFrameCount(channel.length, size)
  const out = new Float32Array(wavetableMipLength(frames))
  out[0] = 1
  out[1] = frames
  out[2] = MIP_LEVELS
  LEVEL_SIZES.forEach((n, l) => { out[3 + l] = n })

  // The analysis size: a power of two covering the cycle, so no detail is lost.
  const m = Math.min(4096, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, size)))))
  const re = new Float64Array(m)
  const im = new Float64Array(m)
  const maxN = LEVEL_SIZES[0]
  const synRe = new Float64Array(maxN)
  const synIm = new Float64Array(maxN)

  for (let f = 0; f < frames; f++) {
    // Resample the cycle onto m points (cubic, wrapping inside the cycle).
    const start = f * size
    for (let j = 0; j < m; j++) {
      re[j] = cyclicCubic(channel, start, size, (j * size) / m)
      im[j] = 0
    }
    fft(re, im, false)

    const harmonics = m / 2 - 1
    let offset = HEADER + f * FRAME_STRIDE
    for (let l = 0; l < MIP_LEVELS; l++) {
      const n = LEVEL_SIZES[l]
      const keep = Math.min(MAX_HARMONICS >> l, harmonics, n / 2 - 1)
      synRe.fill(0, 0, n)
      synIm.fill(0, 0, n)
      // x[k] = Σ c_h e^{i2πhk/n} with c_0 = X0/m, c_h = 2X_h/m: an inverse FFT, real part.
      synRe[0] = re[0] / m
      for (let h = 1; h <= keep; h++) {
        synRe[h] = (2 * re[h]) / m
        synIm[h] = (2 * im[h]) / m
      }
      fft(synRe.subarray(0, n), synIm.subarray(0, n), true)
      for (let k = 0; k < n; k++) out[offset + k] = synRe[k]
      out[offset + n] = out[offset]
      offset += n + 1
    }
  }
  return out
}

/** Catmull-Rom read at `x` frames into the cycle starting at `start`; neighbours
 *  past either end wrap around the cycle (to the nearest frame when `size` is fractional). */
function cyclicCubic(data: Float32Array, start: number, size: number, x: number): number {
  const end = start + size
  const at = (j: number) => {
    let q = j
    if (q >= end) q -= size
    else if (q < start) q += size
    return data[Math.min(data.length - 1, Math.max(0, Math.round(q)))]
  }
  const pos = start + x
  const i = Math.floor(pos)
  const t = pos - i
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
}

/** In-place iterative radix-2 FFT. `inverse` uses e^{+i…} and does not scale. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]]
    }
  }
  const sign = inverse ? 1 : -1
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** One sample cut at one cycle size: the table sets (one per channel) to upload. */
export interface WavetableMipRequest {
  hash: string
  size: number
  /** Keys by channel. */
  keys: string[]
}

/** The tables the doc's wave modules can play: one request per (sample, cycle size). */
export function wavetableMipRequests(doc: Doc, sampleMeta: Record<Id, SampleMeta>): WavetableMipRequest[] {
  const found = new Map<string, WavetableMipRequest>()
  for (const inst of Object.values(doc.entities.instruments)) {
    if (inst.kind !== 'modular') continue
    for (const m of Object.values(inst.modules)) {
      if (m.type !== 'wave' || !m.sampleId) continue
      const meta = sampleMeta[m.sampleId]
      if (!meta?.hash || !fitsWavetable(meta)) continue
      const size = cycleLength(meta, m.params.cycle ?? 0)
      const keys = Array.from({ length: meta.channels }, (_, ch) => wavetableMipKey(meta.hash, size, ch))
      found.set(keys[0], { hash: meta.hash, size, keys })
    }
  }
  return [...found.values()]
}
