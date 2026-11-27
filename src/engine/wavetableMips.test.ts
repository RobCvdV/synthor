import { describe, expect, it } from 'vitest'
import { MIP_LEVELS, buildWavetableMips, mipLayout, wavetableMipKey, wavetableMipLength, wavetableMipRequests } from './wavetableMips'
import type { SampleMeta } from './instruments'
import { createDefaultDoc } from '../domain/factory'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type Doc, type ModularInstrument } from '../domain/types'

const HEADER = 4 + 2 * MIP_LEVELS

/** Level `l` of frame `f` (without its guard sample), read through the header. */
function level(mips: Float32Array, f: number, l: number): Float32Array {
  const size = mips[3 + l]
  const offset = mips[3 + MIP_LEVELS + l]
  const stride = mips[3 + 2 * MIP_LEVELS]
  const at = HEADER + f * stride + offset
  return mips.subarray(at, at + size)
}

/** Amplitude of harmonic h in one cycle of n samples. */
function harmonic(x: Float32Array, h: number): number {
  let re = 0, im = 0
  for (let k = 0; k < x.length; k++) {
    re += x[k] * Math.cos((2 * Math.PI * h * k) / x.length)
    im -= x[k] * Math.sin((2 * Math.PI * h * k) / x.length)
  }
  return (2 * Math.hypot(re, im)) / x.length
}

const saw = (n: number) => Float32Array.from({ length: n }, (_, k) => (2 * k) / n - 1)

describe('buildWavetableMips', () => {
  it('writes the header the native node parses', () => {
    const mips = buildWavetableMips(new Float32Array(3 * 2048), 2048)
    const layout = mipLayout(2048)
    expect(mips.length).toBe(wavetableMipLength(3, 2048))
    expect(Array.from(mips.subarray(0, 3))).toEqual([2, 3, MIP_LEVELS])
    expect(Array.from(mips.subarray(3, 3 + MIP_LEVELS))).toEqual([1024, 1024, 512, 256, 128, 64, 64, 64, 64, 64])
    expect(Array.from(mips.subarray(3 + MIP_LEVELS, 3 + 2 * MIP_LEVELS))).toEqual(layout.offsets)
    expect(mips[3 + 2 * MIP_LEVELS]).toBe(layout.stride)
  })

  it('shares level 0 with level 1 and levels a short cycle cannot fill', () => {
    const long = mipLayout(2048)
    expect(long.harmonics).toEqual([256, 256, 128, 64, 32, 16, 8, 4, 2, 1])
    expect(long.offsets[0]).toBe(long.offsets[1])
    // 1024 + 512 + 256 + 128 + 5 × 64, plus a guard each: about half the 10-level layout.
    expect(long.stride).toBe(2240 + 9)
    // A 256-frame cycle holds at most 127 harmonics: levels 0–2 are one table.
    const short = mipLayout(256)
    expect(short.harmonics.slice(0, 4)).toEqual([127, 127, 127, 64])
    expect(new Set(short.offsets.slice(0, 3)).size).toBe(1)
    expect(short.sizes[0]).toBe(512)
    // 512 + 256 + 128 + 5 × 64, plus 8 guards (it was 10 tables of 4298 floats).
    expect(short.stride).toBe(1224)
  })

  it('reproduces a sine cycle on every level, with a guard sample', () => {
    const n = 1024
    const sine = Float32Array.from({ length: n }, (_, k) => 0.5 * Math.sin((2 * Math.PI * k) / n))
    const mips = buildWavetableMips(sine, n)
    for (let l = 0; l < MIP_LEVELS; l++) {
      const tbl = level(mips, 0, l)
      expect(harmonic(tbl, 1)).toBeCloseTo(0.5, 3)
      expect(tbl[tbl.length / 4]).toBeCloseTo(0.5, 3)
      const guardAt = (tbl.byteOffset - mips.byteOffset) / 4 + tbl.length
      expect(mips[guardAt]).toBe(tbl[0])
    }
  })

  it('keeps only the harmonics each level allows', () => {
    const mips = buildWavetableMips(saw(2048), 2048)
    // Level 3 keeps 512 >> 3 = 64 harmonics: the 64th is there, the 65th gone.
    const tbl = level(mips, 0, 3)
    expect(harmonic(tbl, 64)).toBeCloseTo(2 / (Math.PI * 64), 3)
    expect(harmonic(tbl, 65)).toBeLessThan(1e-4)
    // Level 0 tops out at 256, like level 1.
    const rich = level(mips, 0, 0)
    expect(harmonic(rich, 256)).toBeCloseTo(2 / (Math.PI * 256), 3)
    expect(harmonic(rich, 257)).toBeLessThan(1e-4)
    // The top level is the fundamental alone.
    const top = level(mips, 0, MIP_LEVELS - 1)
    expect(harmonic(top, 1)).toBeCloseTo(2 / Math.PI, 3)
    expect(harmonic(top, 2)).toBeLessThan(1e-4)
  })

  it('cuts frames at fractional cycle sizes and keeps DC', () => {
    // Two cycles of 300.5 frames: a constant 0.25, then a constant −0.5.
    const data = new Float32Array(601).map((_, i) => (i < 300 ? 0.25 : -0.5))
    const mips = buildWavetableMips(data, 300.5)
    expect(mips[1]).toBe(2)
    const mean = (x: Float32Array) => x.reduce((a, b) => a + b, 0) / x.length
    expect(mean(level(mips, 0, 0))).toBeCloseTo(0.25, 2)
    expect(mean(level(mips, 1, 0))).toBeCloseTo(-0.5, 2)
  })

  it('keys one table set per sample, cycle size and channel', () => {
    expect(wavetableMipKey('abc', 2048, 1)).toBe('abc:wt:2048:c1')
    expect(wavetableMipKey('abc', 300.50004, 0)).toBe('abc:wt:300.5:c0')
  })
})

describe('wavetableMipRequests', () => {
  const wave = (id: string, sampleId: string, cycle = 0) => ({ id, type: 'wave' as const, params: { cycle }, sampleId, pos: { x: 0, y: 0 } })
  const docWith = (modules: Record<string, ReturnType<typeof wave>>): Doc => {
    const doc = createDefaultDoc()
    const inst: ModularInstrument = {
      id: 'wt', kind: 'modular', name: 'WT', modules, connections: {}, outputId: 'none',
      effectSettings: { ...DEFAULT_EFFECT_SETTINGS }, channelId: MASTER_CHANNEL_ID, pan: 0,
    }
    return { ...doc, entities: { ...doc.entities, instruments: { ...doc.entities.instruments, wt: inst } } }
  }
  const meta: Record<string, SampleMeta> = {
    table: { hash: 'h1', channels: 2, sampleRate: 44100, frames: 8192, cycleLength: 2048 },
    loading: { hash: '', channels: 1, sampleRate: 44100, frames: 2048 },
    long: { hash: 'h3', channels: 1, sampleRate: 44100, frames: 44100 },
  }

  it('asks for one table set per sample and cycle size, a key per channel', () => {
    const requests = wavetableMipRequests(docWith({
      a: wave('a', 'table'), b: wave('b', 'table'), c: wave('c', 'table', 3),
    }), meta)
    expect(requests).toEqual([
      { hash: 'h1', size: 2048, keys: ['h1:wt:2048:c0', 'h1:wt:2048:c1'] },
      { hash: 'h1', size: 512, keys: ['h1:wt:512:c0', 'h1:wt:512:c1'] },
    ])
  })

  it('skips samples still loading and ones the wave module cannot play', () => {
    expect(wavetableMipRequests(docWith({ a: wave('a', 'loading'), b: wave('b', 'long'), c: wave('c', 'missing') }), meta)).toEqual([])
  })
})
