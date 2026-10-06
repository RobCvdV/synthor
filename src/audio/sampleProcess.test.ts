import { describe, expect, it } from 'vitest'
import { crushRange, driveRange, smoothRange } from './sampleProcess'

const mono = (vals: number[]) => [new Float32Array(vals)]
const square = (n: number, period: number) => Array.from({ length: n }, (_, i) => (i % period < period / 2 ? 1 : -1))
const maxStep = (ch: Float32Array, a = 0, b = ch.length) => {
  let m = 0
  for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(ch[i] - ch[i - 1]))
  return m
}

describe('smoothRange', () => {
  it('softens hard edges without touching audio outside the range', () => {
    const src = mono(square(256, 64))
    const out = smoothRange(src, 64, 192, 0.02)
    expect(maxStep(out[0], 64, 192)).toBeLessThan(0.5)
    expect(Array.from(out[0].subarray(0, 64))).toEqual(Array.from(src[0].subarray(0, 64)))
    expect(Array.from(out[0].subarray(192))).toEqual(Array.from(src[0].subarray(192)))
    expect(maxStep(src[0])).toBe(2)
  })

  it('is zero-phase: a symmetric pulse stays centred', () => {
    const vals = new Array(101).fill(0)
    vals[50] = 1
    const out = smoothRange(mono(vals), 0, 101, 0.05)[0]
    expect(out.indexOf(Math.max(...out))).toBe(50)
    expect(out[45]).toBeCloseTo(out[55], 5)
  })

  it('keeps a constant signal and leaves Nyquist cutoff as a no-op', () => {
    const flat = mono(new Array(32).fill(0.5))
    expect(Array.from(smoothRange(flat, 0, 32, 0.01)[0]).every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true)
    expect(smoothRange(flat, 0, 32, 0.5)).toBe(flat)
  })

  it('filters single cycles as loops, so the wrap point stays seamless', () => {
    const cycle = smoothRange(mono(square(64, 64)), 0, 64, 0.02, 64)[0]
    const wrap = Math.abs(cycle[0] - cycle[63])
    expect(wrap).toBeLessThan(maxStep(cycle) * 1.5)
    // Clamped edges instead would hold the cycle's ends apart.
    const clamped = smoothRange(mono(square(64, 64)), 0, 64, 0.02)[0]
    expect(Math.abs(clamped[0] - clamped[63])).toBeGreaterThan(1)
  })
})

describe('driveRange', () => {
  it('saturates while keeping full scale at full scale', () => {
    const out = driveRange(mono([0.25, 1, -1]), 0, 3, 4)[0]
    expect(out[0]).toBeGreaterThan(0.25)
    expect(out[1]).toBeCloseTo(1, 6)
    expect(out[2]).toBeCloseTo(-1, 6)
  })
})

describe('crushRange', () => {
  it('quantizes to the bit depth and holds frames', () => {
    expect(Array.from(crushRange(mono([0.3, -0.3, 0.8]), 0, 3, 2, 1)[0])).toEqual([0.5, -0.5, 1])
    expect(Array.from(crushRange(mono([0.5, 0.25, -0.5, 1]), 0, 4, 16, 2)[0])).toEqual([0.5, 0.5, -0.5, -0.5])
  })
  it('works per channel and is pure', () => {
    const src = [new Float32Array([0.3]), new Float32Array([-0.3])]
    const out = crushRange(src, 0, 1, 2, 1)
    expect(out.map((c) => c[0])).toEqual([0.5, -0.5])
    expect(src[0][0]).toBeCloseTo(0.3)
  })
})
