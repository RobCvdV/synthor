import { describe, expect, it } from 'vitest'
import { freqToNote, midiToFreq, midiToName, nameToMidi } from './notes'

describe('notes', () => {
  it('converts between notes and frequencies', () => {
    expect(midiToFreq(69)).toBe(440)
    expect(freqToNote(440)).toEqual({ midi: 69, cents: 0 })
    expect(freqToNote(midiToFreq(57) * Math.pow(2, 0.1 / 12))).toEqual({ midi: 57, cents: 10 })
    expect(midiToName(57)).toBe('A-3')
  })

  it('reads note names back, as the grid writes them and as people do', () => {
    expect([nameToMidi('C-4'), nameToMidi('C4'), nameToMidi('c#4'), nameToMidi('Db4'), nameToMidi('A-3')]).toEqual([60, 60, 61, 61, 57])
    expect(nameToMidi(midiToName(0))).toBe(0)
    for (const midi of [21, 69, 72, 108]) expect(nameToMidi(midiToName(midi))).toBe(midi)
    expect([nameToMidi('H4'), nameToMidi('4'), nameToMidi('')]).toEqual([null, null, null])
  })
})
