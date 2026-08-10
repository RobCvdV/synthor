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
  /** Per-row staccato value (0..1). Used by the scheduler for sub-row
   *  gate timing: gate stays on for `staccato` fraction of the row.
   *  Only meaningful on the last row of a note+hold chain. */
  staccatoSeq: number[]
}

export function buildSequences(track: Track, length: number): TrackSequences {
  const freqSeq: number[] = new Array(length)
  const gateSeq: number[] = new Array(length)
  const volumeSeq: number[] = new Array(length)
  const noteSeq: (number | null)[] = new Array(length)
  const staccatoSeq: number[] = new Array(length).fill(1)

  // Per-row volume from cells.
  for (let row = 0; row < length; row++) {
    volumeSeq[row] = track.cells[row]?.volume ?? 1
  }

  // Build per-lane sequences. Default depends on lane type:
  // portamento uses 0.5 (center), volumeSlide uses 1 (passthrough),
  // staccato uses 1 (FF = legato), others use 0.
  const effectLanes: Record<Id, number[]> = {}
  for (const lane of track.effectLanes) {
    const fallback = lane.type === 'portamento' ? 0.5
      : lane.type === 'volumeSlide' ? 1
      : lane.type === 'staccato' ? 1
      : 0
    const seq = new Array(length).fill(fallback)
    for (let row = 0; row < length; row++) {
      const val = track.cells[row]?.effectLanes[lane.id]
      if (val !== null && val !== undefined) seq[row] = val
    }
    effectLanes[lane.id] = seq
  }

  // Find the staccato lane id for this track (if any).
  const staccatoLaneId = track.effectLanes.find((l) => l.type === 'staccato')?.id

  // Read staccato value from a cell. Returns null if no staccato lane or no value set.
  function readStaccato(row: number): number | null {
    if (!staccatoLaneId) return null
    const lanes = track.cells[row]?.effectLanes
    if (!lanes) return null
    const val = lanes[staccatoLaneId]
    return val !== null && val !== undefined ? val : null
  }

  // ── Pass 1: identify note + hold chains ──────────────────────────

  interface NoteChain {
    noteRow: number
    note: number
    lastHoldRow: number    // = noteRow if no holds follow
    nextNoteRow: number    // = length if no next note
  }

  const chains: NoteChain[] = []
  let row = 0
  while (row < length) {
    const cell = track.cells[row]
    const note = cell?.note ?? null

    if (note !== null) {
      const chain: NoteChain = {
        noteRow: row,
        note,
        lastHoldRow: row,
        nextNoteRow: length,
      }

      // Scan forward for holds.
      let scanRow = row + 1
      while (scanRow < length) {
        const scanCell = track.cells[scanRow]
        if (scanCell?.note != null) break       // next note → new chain
        if (scanCell?.noteOff) break            // legacy note-off
        if (scanCell?.hold) {
          chain.lastHoldRow = scanRow
        } else {
          break                                  // empty cell → chain ends
        }
        scanRow++
      }

      // Record next note position (or length if none follows).
      for (let r = chain.lastHoldRow + 1; r < length; r++) {
        if (track.cells[r]?.note != null) {
          chain.nextNoteRow = r
          break
        }
      }

      chains.push(chain)
      row = scanRow // scanRow is at the next note or end
    } else {
      row++
    }
  }

  // ── Pass 2: build gate / freq / note / staccato arrays ────────────
  gateSeq.fill(0)
  freqSeq.fill(0)
  noteSeq.fill(null)

  for (let ci = 0; ci < chains.length; ci++) {
    const chain = chains[ci]
    const freq = midiToFreq(chain.note)

    // Fill note row + hold rows.
    for (let r = chain.noteRow; r <= chain.lastHoldRow; r++) {
      gateSeq[r] = 1
      freqSeq[r] = freq
    }
    noteSeq[chain.noteRow] = chain.note

    // Set staccato on the LAST gate=1 row of this chain.
    // Read from that cell's staccato lane value (if present).
    const lastRow = chain.lastHoldRow
    const sv = readStaccato(lastRow)
    if (sv !== null) staccatoSeq[lastRow] = sv

    // Universal retrigger: if the next note immediately follows the
    // hold chain (gap==0), lower the staccato on the last gate=1 row
    // so the scheduler drops the gate briefly before the next row.
    // Without this the gate stays at 1 continuously and envelopes /
    // drum samples never re-attack.
    if (ci < chains.length - 1) {
      const nextChain = chains[ci + 1]
      if (nextChain.noteRow <= chain.lastHoldRow + 1) {
        if (chain.lastHoldRow > chain.noteRow) {
          // Has holds — sacrifice the last hold row for a full-row gap.
          gateSeq[chain.lastHoldRow] = 0
          staccatoSeq[chain.lastHoldRow] = 1
        } else {
          // Single-row note — lower staccato so the scheduler cuts the
          // gate at ~85% of the row, creating a brief gate=0 before the
          // next row begins (sub-row retrigger gap).
          if (staccatoSeq[chain.lastHoldRow] >= 1) {
            staccatoSeq[chain.lastHoldRow] = 0.85
          }
        }
      }
    }
    // No sustain after the hold chain — gate drops to 0 naturally.
  }

  // Carry frequency forward through release rows so that key-tracked
  // filters and other freq-dependent modules don't see freq=0 during the
  // release phase.  This matches keyboard noteOff behavior, where only
  // the gate drops — the frequency stays at the played note's pitch.
  let lastFreq = 0
  for (let row = 0; row < length; row++) {
    if (freqSeq[row] > 0) lastFreq = freqSeq[row]
    else freqSeq[row] = lastFreq
  }

  // Wrap-around sustain: if the last row is gate=1, carry it forward
  // to the start so the note sustains across the pattern loop boundary.
  // Only a new note or legacy noteOff breaks the wrap — hold signs at the
  // pattern start ARE the continuation (they extend the wrapped note).
  if (gateSeq[length - 1] === 1) {
    for (let row = 0; row < length; row++) {
      const cell = track.cells[row]
      if (cell?.note != null || cell?.noteOff) break
      gateSeq[row] = 1
      freqSeq[row] = freqSeq[length - 1]
    }
  }

  return { freqSeq, gateSeq, volumeSeq, noteSeq, effectLanes, laneDefs: track.effectLanes, staccatoSeq }
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
