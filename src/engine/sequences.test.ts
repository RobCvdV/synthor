import { describe, expect, it } from 'vitest'
import { buildSequences } from './sequences'
import { midiToFreq } from '../domain/notes'
import type { Track } from '../domain/types'

function cell(note: number | null, noteOff = false, volume: number | null = null) {
  return { note, noteOff, volume, effect: null, effectValue: null }
}

function trackOf(notes: (number | null)[]): Track {
  return { id: 't', instrumentId: 'i', cells: notes.map((note) => ({ note, volume: null, noteOff: false, effect: null, effectValue: null })) }
}

describe('buildSequences', () => {
  it('sustains gate across empty rows until note-off or new note', () => {
    const t = trackOf([60, null, 64, null])
    const { gateSeq } = buildSequences(t, 4)
    // Row 0: note → gate=1. Row 1: sustain → gate=1. Row 2: new note → gate=1. Row 3: sustain → gate=1.
    expect(gateSeq).toEqual([1, 1, 1, 1])
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

  it('outputs 0 Hz before the first note, sustains across loop boundary', () => {
    const t = trackOf([null, null, 67])
    const { freqSeq, gateSeq } = buildSequences(t, 3)
    expect(freqSeq[0]).toBe(0)
    // Row 2 has the note (gate=1). The pattern loops, so the note sustains
    // across the boundary into rows 0-1 via wrap-around propagation.
    expect(gateSeq).toEqual([1, 1, 1])
  })

  it('always returns arrays of the pattern length', () => {
    const t = trackOf([60])
    const { freqSeq, gateSeq } = buildSequences(t, 8)
    expect(freqSeq).toHaveLength(8)
    expect(gateSeq).toHaveLength(8)
  })

  it('note-off forces gate to 0 and keeps last freq', () => {
    const t: Track = {
      id: 't', instrumentId: 'i',
      cells: [
        cell(60),            // note on C4 → gate=1
        cell(null),           // empty → sustain gate=1
        cell(null, true),     // note-off → gate=0
        cell(null),           // empty → gate=0 (not holding)
      ],
    }
    const { gateSeq, freqSeq } = buildSequences(t, 4)
    // Rows 0-1: gate=1 (note + sustain), rows 2-3: gate=0 (note-off + silence)
    expect(gateSeq).toEqual([1, 1, 0, 0])
    // Freq should hold C4 through the note-off row for release pitch.
    expect(freqSeq[2]).toBe(midiToFreq(60))
  })

  it('note-off with a new note triggers the note instead', () => {
    const t: Track = {
      id: 't', instrumentId: 'i',
      cells: [
        cell(60),
        cell(64, true),  // both note and note-off → note wins
      ],
    }
    const { gateSeq } = buildSequences(t, 2)
    expect(gateSeq[1]).toBe(1)
  })

  it('volume defaults to 1 and passes through per-cell values', () => {
    const t: Track = {
      id: 't', instrumentId: 'i',
      cells: [
        cell(60, false, 0.5),
        cell(null, false, null),  // default volume
        cell(64, false, 0),
      ],
    }
    const { volumeSeq } = buildSequences(t, 3)
    expect(volumeSeq).toEqual([0.5, 1, 0])
  })
})
