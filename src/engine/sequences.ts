import type { DrumKitInstrument, Track } from '../domain/types'
import { getSlotForNote } from '../domain/types'
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
 * - `volumeSeq`: per-row volume modifier (0..1), defaults to 1.
 */
export interface TrackSequences {
  freqSeq: number[]
  gateSeq: number[]
  volumeSeq: number[]
  /** Raw MIDI note numbers — used by drumkit instruments for slot mapping. */
  noteSeq: (number | null)[]
}

export function buildSequences(track: Track, length: number): TrackSequences {
  const freqSeq: number[] = new Array(length)
  const gateSeq: number[] = new Array(length)
  const volumeSeq: number[] = new Array(length)
  const noteSeq: (number | null)[] = new Array(length)
  let lastFreq = 0

  for (let row = 0; row < length; row++) {
    const note = track.cells[row]?.note ?? null

    // Per-cell volume (unused in audio path for now — kept for UI display).
    volumeSeq[row] = track.cells[row]?.volume ?? 1

    if (note !== null) {
      lastFreq = midiToFreq(note)
      gateSeq[row] = 1
      noteSeq[row] = note
    } else {
      gateSeq[row] = 0
      noteSeq[row] = null
    }
    freqSeq[row] = lastFreq
  }

  return { freqSeq, gateSeq, volumeSeq, noteSeq }
}

/** Per-slot sequences for a drumkit track: one gate + freq per slot. */
export interface DrumKitSlotSequences {
  slotGateSeqs: Record<string, number[]>
  slotFreqSeqs: Record<string, number[]>
}

/**
 * Build per-slot gate and frequency sequences for a drumkit track.
 * Each row is dispatched to exactly one slot based on the cell's MIDI note
 * (nearest slot.note <= cell.note). Rows with no note or no matching slot
 * produce silence for that slot.
 */
export function buildDrumKitSlotSequences(
  track: Track,
  length: number,
  drumkit: DrumKitInstrument,
): DrumKitSlotSequences {
  const slotGateSeqs: Record<string, number[]> = {}
  const slotFreqSeqs: Record<string, number[]> = {}

  // Initialise empty arrays for every slot.
  for (const slot of drumkit.slots) {
    slotGateSeqs[slot.id] = new Array(length).fill(0)
    slotFreqSeqs[slot.id] = new Array(length).fill(0)
  }

  for (let row = 0; row < length; row++) {
    const note = track.cells[row]?.note ?? null
    if (note === null) continue

    const slot = getSlotForNote(drumkit, note)
    if (!slot) continue

    slotGateSeqs[slot.id][row] = 1
    slotFreqSeqs[slot.id][row] = midiToFreq(note + slot.pitchOffset)
  }

  return { slotGateSeqs, slotFreqSeqs }
}
