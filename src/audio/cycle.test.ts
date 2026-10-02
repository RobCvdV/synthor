import { describe, expect, it } from 'vitest'
import { detectPeriod, detectPeriodIn, extractCycle, loopCycle } from './cycle'
import { framesOf } from './sampleEdit'
import { CYCLE_PEAK } from './waveGen'

const SR = 48000

/** A 220 Hz tone with a few harmonics, starting mid-cycle. */
function tone(frames: number, hz = 220, offset = 0.1) {
  return Float32Array.from({ length: frames }, (_, i) => {
    const ph = 2 * Math.PI * hz * i / SR + offset
    return 0.4 * Math.sin(ph) + 0.2 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph + 1) + 0.05
  })
}

describe('detectPeriod', () => {
  it('finds a fractional period with harmonics present', () => {
    const est = detectPeriod(tone(8000), 0, 8000, SR)!
    expect(est.period).toBeCloseTo(SR / 220, 1)
    expect(est.frequency).toBeCloseTo(220, 0)
    expect(est.clarity).toBeGreaterThan(0.9)
  })

  it('finds low and high notes', () => {
    expect(detectPeriod(tone(12000, 55), 0, 12000, SR)!.frequency).toBeCloseTo(55, 0)
    expect(detectPeriod(tone(4000, 1760), 0, 4000, SR)!.frequency).toBeCloseTo(1760, -1)
  })

  it('gives up on noise and on too little audio', () => {
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    expect(detectPeriod(Float32Array.from({ length: 8000 }, rnd), 0, 8000, SR)).toBeNull()
    expect(detectPeriod(tone(8000), 0, 20, SR)).toBeNull()
  })

  it('reads the mono mix of stereo audio', () => {
    expect(detectPeriodIn([tone(8000), tone(8000)], 1000, 7000, SR)!.frequency).toBeCloseTo(220, 0)
  })
})

describe('extractCycle', () => {
  const data = [tone(8000)]
  const period = SR / 220

  it('makes a normalized, DC-free cycle of the requested length that wraps cleanly', () => {
    const cycle = extractCycle(data, 1000, 6000, { length: 2048, period, average: true })[0]
    expect(framesOf([cycle])).toBe(2048)
    expect(Math.max(...cycle.map(Math.abs))).toBeCloseTo(CYCLE_PEAK, 5)
    expect(cycle.reduce((s, v) => s + v, 0) / 2048).toBeCloseTo(0, 3)
    // Neighbouring frames stay close, including across the wrap.
    const maxStep = Math.max(...cycle.map((v, i) => Math.abs(v - cycle[(i + 1) % 2048])))
    expect(Math.abs(cycle[0] - cycle[2047])).toBeLessThan(maxStep * 1.5)
  })

  it('starts on a rising zero crossing', () => {
    const cycle = extractCycle(data, 1234, 6000, { length: 512, period })[0]
    expect(Math.abs(cycle[0])).toBeLessThan(0.02)
    expect(cycle[4]).toBeGreaterThan(cycle[0])
  })

  it('takes the whole range as one cycle without a period', () => {
    const cycle = extractCycle([Float32Array.from({ length: 100 }, (_, i) => Math.sin(2 * Math.PI * i / 100))], 0, 100, { length: 400 })[0]
    expect(cycle.length).toBe(400)
    expect(cycle[100]).toBeCloseTo(CYCLE_PEAK, 2)
  })

  it('keeps stereo', () => {
    expect(extractCycle([tone(8000), tone(8000, 220, 1)], 0, 8000, { length: 256, period })).toHaveLength(2)
  })
})

describe('loopCycle', () => {
  it('repeats the cycle at the given period', () => {
    const cycle = [Float32Array.from({ length: 256 }, (_, i) => Math.sin(2 * Math.PI * i / 256))]
    const out = loopCycle(cycle, 100, 1000)[0]
    expect(out.length).toBe(1000)
    for (const i of [25, 125, 525, 925]) expect(out[i]).toBeCloseTo(1, 2)
  })
})
