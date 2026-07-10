import type { Track } from '../domain/types'
import { midiToFreq } from '../domain/notes'

/**
 * Per-row control signals for one track, ready to feed into el.seq2.
 *
 * - `freqSeq`: the frequency to sound on each row. Notes are held forward
 *   across empty rows so the release tail keeps its pitch (0 before the first
 *   note).
 * - `gateSeq`: 1 on rows where a new note starts, 0 otherwise. Driven through
 *   an envelope, the rising edge triggers attack and the fall (next row)
 *   triggers release — giving one-row gates for the slice.
 */
export interface TrackSequences {
  freqSeq: number[]
  gateSeq: number[]
}

export function buildSequences(track: Track, length: number): TrackSequences {
  const freqSeq: number[] = new Array(length)
  const gateSeq: number[] = new Array(length)
  let lastFreq = 0

  for (let row = 0; row < length; row++) {
    const note = track.cells[row]?.note ?? null
    if (note !== null) {
      lastFreq = midiToFreq(note)
      gateSeq[row] = 1
    } else {
      gateSeq[row] = 0
    }
    freqSeq[row] = lastFreq
  }

  return { freqSeq, gateSeq }
}
