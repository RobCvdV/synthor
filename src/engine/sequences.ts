import type { DrumKitInstrument, Track } from '../domain/types'
import { getSlotForNote } from '../domain/types'
import { midiToFreq } from '../domain/notes'

/**
 * Per-row control signals for one track, ready to feed into el.seq2.
 *
 * - `freqSeq`: the frequency to sound on each row. Notes are held forward
 *   across empty rows so the release tail keeps its pitch (0 before the first
 *   note).
 * - `gateSeq`: 1 while a note is active (attack/sustain), 0 on release.
 *   New notes retrigger the gate; note-off drops it; empty rows between
 *   notes sustain — giving real sustained-note behavior instead of one-row
 *   staccato gates.
 * - `volumeSeq`: per-row volume modifier (0..1), defaults to 1.
 * - `noteSeq`: raw MIDI note numbers — used by drumkit instruments for slot
 *   mapping.
 * - `effectSeq`: packed effect command per row (0x000–0xFFF), or null.
 * - `effectValueSeq`: effect operand per row (0x00–0xFF), or null.
 */
export interface TrackSequences {
  freqSeq: number[]
  gateSeq: number[]
  volumeSeq: number[]
  /** Raw MIDI note numbers — used by drumkit instruments for slot mapping. */
  noteSeq: (number | null)[]
  /** Packed effect command per row (0x000–0xFFF), or null when no effect. */
  effectSeq: (number | null)[]
  /** Effect operand per row (0x00–0xFF), or null when no effect. */
  effectValueSeq: (number | null)[]
}

export function buildSequences(track: Track, length: number): TrackSequences {
  const freqSeq: number[] = new Array(length)
  const gateSeq: number[] = new Array(length)
  const volumeSeq: number[] = new Array(length)
  const noteSeq: (number | null)[] = new Array(length)
  const effectSeq: (number | null)[] = new Array(length)
  const effectValueSeq: (number | null)[] = new Array(length)
  let lastFreq = 0
  let holding = false

  for (let row = 0; row < length; row++) {
    const cell = track.cells[row]
    const note = cell?.note ?? null
    const noteOff = cell?.noteOff ?? false

    volumeSeq[row] = cell?.volume ?? 1
    effectSeq[row] = cell?.effect ?? null
    effectValueSeq[row] = cell?.effectValue ?? null

    if (note !== null) {
      // New note — retrigger gate, update frequency.
      lastFreq = midiToFreq(note)
      gateSeq[row] = 1
      noteSeq[row] = note
      holding = true
    } else if (noteOff) {
      // Explicit note-off — release the gate.
      gateSeq[row] = 0
      noteSeq[row] = null
      holding = false
    } else if (holding) {
      // No note, no note-off — sustain the previous gate.
      gateSeq[row] = 1
      noteSeq[row] = null
    } else {
      // Not holding and no note — silence.
      gateSeq[row] = 0
      noteSeq[row] = null
    }
    freqSeq[row] = lastFreq
  }

  // Wrap-around sustain: if a note is held at the last row without a note-off,
  // carry it forward to the start so the sustain continues across the pattern
  // loop boundary (the sequencer loops, so gate[N-1]=1 → gate[0]=1 is seamless).
  if (gateSeq[length - 1] === 1) {
    for (let row = 0; row < length; row++) {
      const cell = track.cells[row]
      if (cell?.note != null || cell?.noteOff) break // hit a new event, stop wrapping
      gateSeq[row] = 1
    }
  }

  return { freqSeq, gateSeq, volumeSeq, noteSeq, effectSeq, effectValueSeq }
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
    // Drum samples don't pitch-track to the cell note — the note only selects
    // which slot fires. The playback speed is determined by the slot's own
    // note + pitchOffset, so a kick always sounds like a kick regardless of
    // which MIDI note triggers it.
    slotFreqSeqs[slot.id][row] = midiToFreq(slot.note + slot.pitchOffset)
  }

  return { slotGateSeqs, slotFreqSeqs }
}
