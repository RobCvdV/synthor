import { describe, expect, it } from 'vitest'
import { clockRow, createClock, musicalTime, observeRow, sendDelay, setClockRate, type SongClock } from './songClock'

const BLOCK_S = 512 / 44100 // txSeq emits every 4 blocks of 128 frames

/** A deterministic 0..1 sequence, so delivery delays vary without flaky tests. */
function lcg(seed: number) {
  let s = seed
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32
}

/**
 * Feeds the clock events the way the player gets them: every block group the
 * node reports floor(position) (wrapped to `length`), and the event lands
 * 1–9 ms later. Returns the clock and the true position function.
 */
function run(rate: number, startRow: number, seconds: number, length = Infinity, seed = 1) {
  const truth = (t: number) => startRow + rate * t
  const rnd = lcg(seed)
  let clock: SongClock = createClock(rate)
  let t = 0
  for (; t < seconds; t += BLOCK_S) {
    const row = Math.floor(truth(t)) % length
    clock = observeRow(clock, row, t + 0.001 + 0.008 * rnd())
  }
  return { clock, truth, end: t }
}

/** Error in seconds between the clock and the truth, compared within the loop. */
function errorS(clock: SongClock, truth: (t: number) => number, t: number, length = Infinity) {
  const est = clockRow(clock, t)!
  let d = est - truth(t)
  if (Number.isFinite(length)) d = ((d % length) + length * 1.5) % length - length / 2
  return Math.abs(d) / clock.rate
}

describe('songClock', () => {
  it('has no position before the first event', () => {
    expect(clockRow(createClock(8), 1)).toBeNull()
  })

  it('locks onto the row boundaries: within 12 ms after 1 s, 5 ms after 6 s', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const early = run(8, 0.37, 1, Infinity, seed)
      expect(errorS(early.clock, early.truth, early.end)).toBeLessThan(0.012)
      const { clock, truth, end } = run(8, 0.37, 6, Infinity, seed)
      for (const t of [end, end + 0.05, end + 0.11]) expect(errorS(clock, truth, t)).toBeLessThan(0.005)
    }
  })

  it('keeps the lock across loop wraps', () => {
    const { clock, truth, end } = run(8, 0.71, 6, 16, 7)
    expect(errorS(clock, truth, end, 16)).toBeLessThan(0.005)
  })

  it('holds at fast tempos too', () => {
    const { clock, truth, end } = run(24, 0.2, 3, 64, 3)
    expect(errorS(clock, truth, end, 64)).toBeLessThan(0.005)
  })

  it('renumbers on a jump without losing the phase within the row', () => {
    const { clock, end } = run(8, 0.37, 3)
    const before = clockRow(clock, end)!
    const jumped = observeRow(clock, 3, end)
    const after = clockRow(jumped, end)!
    expect(after - Math.floor(after)).toBeCloseTo(before - Math.floor(before), 6)
    expect(Math.floor(after)).toBe(3)
  })

  it('carries the position on through a tempo change', () => {
    const { clock, end } = run(8, 0.37, 3)
    const at = clockRow(clock, end)!
    const faster = setClockRate(clock, 12, end)
    expect(clockRow(faster, end)).toBeCloseTo(at, 9)
    expect(clockRow(faster, end + 1)! - at).toBeCloseTo(12, 9)
  })
})

describe('musicalTime', () => {
  it('splits a row into beats and bars', () => {
    expect(musicalTime(22, 4, 4)).toEqual({ row: 22, beat: 5.5, beatPhase: 0.5, beatInBar: 1, bar: 1, barPhase: 0.375 })
  })
})

describe('sendDelay', () => {
  it('sends ahead of the next grid point by the latency', () => {
    expect(sendDelay(0.3, 0.05, 0.5)).toBeCloseTo(0.25, 9)
  })

  it('moves on to the next reachable point when this one is too close', () => {
    expect(sendDelay(0.02, 0.05, 0.5)).toBeCloseTo(0.47, 9)
    expect(sendDelay(0.02, 0.6, 0.25)).toBeCloseTo(0.17, 9)
  })

  it('sends at once without a grid', () => {
    expect(sendDelay(0.02, 0.05, 0)).toBe(0)
  })
})
