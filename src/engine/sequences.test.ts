import { describe, expect, it } from 'vitest'
import { buildSequences } from './sequences'
import { midiToFreq } from '../domain/notes'
import type { Track } from '../domain/types'

function trackOf(notes: (number | null)[]): Track {
  return { id: 't', instrumentId: 'i', cells: notes.map((note) => ({ note })) }
}

describe('buildSequences', () => {
  it('gates only on rows with a new note', () => {
    const t = trackOf([60, null, 64, null])
    const { gateSeq } = buildSequences(t, 4)
    expect(gateSeq).toEqual([1, 0, 1, 0])
  })

  it('holds frequency forward across empty rows', () => {
    const t = trackOf([60, null, null, 64])
    const { freqSeq } = buildSequences(t, 4)
    expect(freqSeq).toEqual([
      midiToFreq(60),
      midiToFreq(60),
      midiToFreq(60),
      midiToFreq(64),
    ])
  })

  it('outputs 0 Hz before the first note', () => {
    const t = trackOf([null, null, 67])
    const { freqSeq, gateSeq } = buildSequences(t, 3)
    expect(freqSeq[0]).toBe(0)
    expect(gateSeq).toEqual([0, 0, 1])
  })

  it('always returns arrays of the pattern length', () => {
    const t = trackOf([60])
    const { freqSeq, gateSeq } = buildSequences(t, 8)
    expect(freqSeq).toHaveLength(8)
    expect(gateSeq).toHaveLength(8)
  })
})
