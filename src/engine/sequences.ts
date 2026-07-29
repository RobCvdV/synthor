import type { DrumKitInstrument, EffectLaneDef, Id, Track } from '../domain/types'
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
 * - `effectLanes`: per-effect-lane value sequences (0..1), keyed by lane def id.
 */
export interface TrackSequences {
  freqSeq: number[]
  gateSeq: number[]
  volumeSeq: number[]
  /** Raw MIDI note numbers — used by drumkit instruments for slot mapping. */
  noteSeq: (number | null)[]
  /** Per-effect-lane value arrays (0..1), keyed by lane def id. Defaults to 0. */
  effectLanes: Record<Id, number[]>
  /** Lane definitions from the track, passed through for signal processing. */
  laneDefs: EffectLaneDef[]
}

export function buildSequences(track: Track, length: number): TrackSequences {
  const freqSeq: number[] = new Array(length)
  const gateSeq: number[] = new Array(length)
  const volumeSeq: number[] = new Array(length)
  const noteSeq: (number | null)[] = new Array(length)
  let lastFreq = 0
  let holding = false

  // Build per-lane sequences. Default depends on lane type:
  // portamento uses 0.5 (center = no change), volumeSlide uses 1 (passthrough).
  const effectLanes: Record<Id, number[]> = {}
  for (const lane of track.effectLanes) {
    const fallback = lane.type === 'portamento' ? 0.5 : lane.type === 'volumeSlide' ? 1 : 0
    const seq = new Array(length).fill(fallback)
    for (let row = 0; row < length; row++) {
      const val = track.cells[row]?.effectLanes[lane.id]
      if (val !== null && val !== undefined) seq[row] = val
    }
    effectLanes[lane.id] = seq
  }

  for (let row = 0; row < length; row++) {
    const cell = track.cells[row]
    const note = cell?.note ?? null
    const noteOff = cell?.noteOff ?? false

    volumeSeq[row] = cell?.volume ?? 1

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

  return { freqSeq, gateSeq, volumeSeq, noteSeq, effectLanes, laneDefs: track.effectLanes }
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
    // For sample-based slots the cell note only selects which slot fires;
    // playback speed is determined by the slot's own note + pitchOffset so a
    // kick always sounds like a kick regardless of which MIDI note triggers it.
    // For instrument (synth) slots the cell note IS the pitch — the slot's
    // note only defines the key-range assignment, and pitchOffset fine-tunes
    // the synth's frequency.
    const baseNote = slot.instrumentId ? note : slot.note
    slotFreqSeqs[slot.id][row] = midiToFreq(baseNote + slot.pitchOffset)
  }

  return { slotGateSeqs, slotFreqSeqs }
}
