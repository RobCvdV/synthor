import { describe, expect, it } from 'vitest'
import { generateWaveform } from './waveGen'

describe('generateWaveform', () => {
  const N = 11025 // 0.25 s at 44.1 kHz — WAVEFORM_MAX_LENGTH_SECONDS

  it('sine is one full cycle starting at zero', () => {
    const data = generateWaveform('sine', N)
    expect(Math.abs(data[0])).toBeLessThan(1e-6)
    expect(data[Math.floor(N / 4)]).toBeCloseTo(0.8, 4) // 90° = peak
    expect(data[Math.floor(N / 2)]).toBeCloseTo(0, 3) // 180° = zero (odd N → off by <1 frame)
    expect(data[Math.floor(N * 3 / 4)]).toBeCloseTo(-0.8, 4)
    // End of buffer must meet the start (loop seam) — last sample ≈ 0.
    expect(Math.abs(data[N - 1])).toBeLessThan(1e-3)
  })

  it('square is one cycle: +half then −half, no NaN at the boundary', () => {
    const data = generateWaveform('square', N)
    expect(data[0]).toBeCloseTo(0.8, 5)
    expect(data[Math.floor(N / 4)]).toBeCloseTo(0.8, 5)
    expect(data[Math.floor(N / 2)]).toBeCloseTo(0.8, 5) // phase < 0.5 (odd N)
    expect(data[Math.floor(N / 2) + 1]).toBeCloseTo(-0.8, 5)
    expect(data[N - 1]).toBeCloseTo(-0.8, 5)
    for (let i = 0; i < N; i++) {
      expect(Math.abs(Math.abs(data[i]) - 0.8)).toBeLessThan(1e-6)
    }
  })

  it('saw ramps -amp → +amp once', () => {
    const data = generateWaveform('saw', N)
    expect(data[0]).toBeCloseTo(-0.8, 4)
    expect(data[Math.floor(N / 4)]).toBeCloseTo(-0.4, 4)
    expect(data[Math.floor(N / 2)]).toBeCloseTo(0, 3)
    expect(data[N - 1]).toBeLessThan(0.8) // just before the wrap
  })

  it('triangle: peak → zero → −peak → zero', () => {
    const data = generateWaveform('triangle', N)
    expect(data[0]).toBeCloseTo(0.8, 4)
    expect(data[Math.floor(N / 4)]).toBeCloseTo(0, 3)
    expect(data[Math.floor(N / 2)]).toBeCloseTo(-0.8, 3)
    expect(data[Math.floor(N * 3 / 4)]).toBeCloseTo(0, 3)
  })

  it('noise stays within amplitude bounds and is non-deterministic', () => {
    const data = generateWaveform('noise', 1000)
    expect(data.length).toBe(1000)
    for (let i = 0; i < data.length; i++) {
      expect(Math.abs(data[i])).toBeLessThanOrEqual(0.8)
    }
    const again = generateWaveform('noise', 1000)
    expect(Array.from(data)).not.toEqual(Array.from(again))
  })
})
