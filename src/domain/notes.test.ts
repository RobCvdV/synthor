import { describe, expect, it } from 'vitest'
import { freqToNote, midiToFreq, midiToName } from './notes'

describe('notes', () => {
  it('converts between notes and frequencies', () => {
    expect(midiToFreq(69)).toBe(440)
    expect(freqToNote(440)).toEqual({ midi: 69, cents: 0 })
    expect(freqToNote(midiToFreq(57) * Math.pow(2, 0.1 / 12))).toEqual({ midi: 57, cents: 10 })
    expect(midiToName(57)).toBe('A-3')
  })
})
