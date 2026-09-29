import { describe, expect, it } from 'vitest'
import { tapTempo } from './tapTempo'

function tapAt(...times: number[]) {
  let state = { times: [] as number[], bpm: null as number | null }
  for (const t of times) state = tapTempo(state.times, t)
  return state
}

describe('tapTempo', () => {
  it('needs two taps', () => {
    expect(tapAt(0).bpm).toBeNull()
  })

  it('averages the tap intervals', () => {
    expect(tapAt(0, 500, 1000, 1500).bpm).toBe(120)
  })

  it('starts over after a pause', () => {
    expect(tapAt(0, 500, 5000).bpm).toBeNull()
  })

  it('keeps only the last eight taps', () => {
    const slowThenFast = [0, 1000, 2000, ...Array.from({ length: 8 }, (_, i) => 2500 + i * 500)]
    expect(tapAt(...slowThenFast).bpm).toBe(120)
    expect(tapAt(...slowThenFast).times).toHaveLength(8)
  })

  it('clamps to 20–300 BPM', () => {
    expect(tapAt(0, 100).bpm).toBe(300)
  })
})
