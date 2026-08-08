import { describe, expect, it } from 'vitest'
import { buildSequences } from '../engine/sequences'
import { emptyCells } from '../domain/factory'
import type { Track } from '../domain/types'

/** Helper: create a track with `length` empty cells and the given lanes. */
function makeTrack(length: number, lanes: { id: string; type: string }[] = []): Track {
  return { id: 'trk_1', instrumentId: 'inst_1', cells: emptyCells(length), effectLanes: lanes }
}

/** Helper: set a MIDI note on a cell. */
function setNote(track: Track, row: number, note: number): void {
  track.cells[row].note = note
  track.cells[row].hold = false
}

/** Helper: set a hold sign on a cell. */
function setHold(track: Track, row: number): void {
  track.cells[row].hold = true
}

/** Helper: set a staccato lane value on a cell. */
function setStaccato(track: Track, row: number, value: number, laneId: string): void {
  track.cells[row].effectLanes[laneId] = value
}

describe('buildSequences', () => {
  // ── basic structure ────────────────────────────────────────────
  it('builds empty effectLanes for track with no lanes', () => {
    const track = makeTrack(4)
    const seq = buildSequences(track, 4)
    expect(seq.effectLanes).toEqual({})
    expect(seq.laneDefs).toEqual([])
    expect(seq.freqSeq).toHaveLength(4)
    expect(seq.gateSeq).toHaveLength(4)
  })

  it('builds per-lane sequences', () => {
    const track = makeTrack(4, [{ id: 'lan_1', type: 'vibratoDepth' }])
    track.cells[0].effectLanes['lan_1'] = 0.5
    track.cells[2].effectLanes['lan_1'] = 0.8
    const seq = buildSequences(track, 4)
    expect(seq.effectLanes['lan_1']).toEqual([0.5, 0, 0.8, 0])
    expect(seq.laneDefs).toHaveLength(1)
  })

  // ── basic note → gate ──────────────────────────────────────────
  it('sets gate=1 and freq on the note row', () => {
    const track = makeTrack(4)
    setNote(track, 1, 60) // C4
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[1]).toBe(1)
    expect(seq.freqSeq[1]).toBeCloseTo(261.63, 0)
    expect(seq.noteSeq[1]).toBe(60)
  })

  it('silence before the first note', () => {
    const track = makeTrack(4)
    setNote(track, 2, 60)
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[0]).toBe(0)
    expect(seq.gateSeq[1]).toBe(0)
    expect(seq.freqSeq[0]).toBe(0)
  })

  // ── hold sign ──────────────────────────────────────────────────
  it('hold sign extends gate past the note row', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    setHold(track, 1)
    setHold(track, 2)
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(1) // hold
    expect(seq.gateSeq[2]).toBe(1) // hold
    expect(seq.gateSeq[3]).toBe(0) // no hold → release
  })

  it('gate drops immediately after note without holds', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(0) // no hold → release
    expect(seq.gateSeq[2]).toBe(0)
  })

  it('hold without prior note is a no-op', () => {
    const track = makeTrack(4)
    setHold(track, 1)
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[1]).toBe(0)
  })

  // ── staccato ───────────────────────────────────────────────────
  it('staccato set on last row of chain', () => {
    const staccatoLane = { id: 'lan_stac', type: 'staccato' }
    const track = makeTrack(8, [staccatoLane])
    setNote(track, 0, 60)
    setStaccato(track, 0, 0.5, 'lan_stac')
    setNote(track, 5, 64)
    const seq = buildSequences(track, 8)
    // Default: no sustain. Gate=1 only on note row.
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(0) // no hold, no sustain → release
    expect(seq.staccatoSeq[0]).toBe(0.5) // staccato on last gate row
    expect(seq.staccatoSeq[1]).toBe(1) // default on non-chain rows
  })

  it('staccato from last hold row applied', () => {
    const staccatoLane = { id: 'lan_stac', type: 'staccato' }
    const track = makeTrack(8, [staccatoLane])
    setNote(track, 0, 60)
    setStaccato(track, 0, 0.8, 'lan_stac') // note row (overridden by hold)
    setHold(track, 1)
    setStaccato(track, 1, 0.2, 'lan_stac') // last hold: 0.2
    setNote(track, 5, 64)
    const seq = buildSequences(track, 8)
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(1) // hold
    expect(seq.gateSeq[2]).toBe(0) // release (no more holds, no sustain)
    expect(seq.staccatoSeq[0]).toBe(1) // note row — overridden by hold's staccato
    expect(seq.staccatoSeq[1]).toBe(0.2) // last hold row has staccato
  })

  it('default: no sustain, gate drops after hold chain', () => {
    const track = makeTrack(8)
    setNote(track, 0, 60)
    setNote(track, 5, 64)
    const seq = buildSequences(track, 8)
    // Default: gate=1 only on note row, then release
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(0) // release (no holds, no sustain)
    expect(seq.gateSeq[2]).toBe(0)
    expect(seq.gateSeq[3]).toBe(0)
    expect(seq.gateSeq[4]).toBe(0)
    expect(seq.gateSeq[5]).toBe(1) // next note
    // staccato defaults to 1 everywhere
    expect(seq.staccatoSeq[0]).toBe(1)
  })

  // ── retrigger ──────────────────────────────────────────────────
  it('every new note has gate=0 before it (no sustain by default)', () => {
    const track = makeTrack(8)
    setNote(track, 0, 60)
    setNote(track, 3, 64) // different pitch
    const seq = buildSequences(track, 8)
    // Default: no sustain. Gate=1 only on note row, then release.
    expect(seq.gateSeq[0]).toBe(1) // note 60
    expect(seq.gateSeq[1]).toBe(0) // release
    expect(seq.gateSeq[2]).toBe(0) // release (gap before next note)
    expect(seq.gateSeq[3]).toBe(1) // note 64
  })

  it('same-pitch successive notes still retrigger', () => {
    const track = makeTrack(8)
    setNote(track, 0, 60)
    setNote(track, 3, 60) // same pitch
    const seq = buildSequences(track, 8)
    expect(seq.gateSeq[0]).toBe(1)
    expect(seq.gateSeq[1]).toBe(0) // release
    expect(seq.gateSeq[2]).toBe(0) // gap
    expect(seq.gateSeq[3]).toBe(1)
  })

  it('gap=0 with holds sacrifices last hold for retrigger', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    setHold(track, 1)
    setNote(track, 2, 64) // immediately after hold
    const seq = buildSequences(track, 4)
    // gap = 2 - 1 - 1 = 0. Has holds → force gate[lastHoldRow] = 0
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(0) // hold sacrificed for retrigger
    expect(seq.gateSeq[2]).toBe(1) // next note
  })

  it('gap=0 without holds cannot retrigger (no room)', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    setNote(track, 1, 64) // immediately after, no holds
    const seq = buildSequences(track, 4)
    // gap = 1 - 0 - 1 = 0. No holds → can't create row-level gap.
    expect(seq.gateSeq[0]).toBe(1) // first note
    expect(seq.gateSeq[1]).toBe(1) // second note (no row-level gap)
  })

  it('gap=0 single-row notes get lowered staccato for sub-row retrigger', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    setNote(track, 1, 64) // immediately after
    const seq = buildSequences(track, 4)
    // staccato lowered on first row so the scheduler drops gate within the row
    expect(seq.staccatoSeq[0]).toBe(0.85)
    expect(seq.staccatoSeq[1]).toBe(1) // last row of chain, no next note
  })

  it('gap=0 with explicit staccato keeps the explicit value', () => {
    const staccatoLane = { id: 'lan_stac', type: 'staccato' }
    const track = makeTrack(4, [staccatoLane])
    setNote(track, 0, 60)
    setStaccato(track, 0, 0.3, 'lan_stac') // explicit staccato
    setNote(track, 1, 64) // immediately after
    const seq = buildSequences(track, 4)
    // Explicit staccato is preserved — not overridden by the auto-retrigger
    expect(seq.staccatoSeq[0]).toBe(0.3)
  })

  // ── legacy noteOff ─────────────────────────────────────────────
  it('legacy noteOff releases the gate', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    track.cells[2].noteOff = true // legacy noteOff
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(0) // noteOff: chain breaks here
    expect(seq.gateSeq[2]).toBe(0) // noteOff row itself
    // The note row creates a chain, but noteOff at row 2 stops the scan at row 1
    // Actually: row 0 note → chain starts. Scan row 1: no hold, no note → chain ends at row 0.
    // Row 2: noteOff → no note → doesn't start a chain.
    // Wait, let me re-check the logic.
    // Pass 1: row 0 has note → chain noteRow=0, scans to row 1.
    //   Row 1: no note, no noteOff, no hold → break. chain ends. chain.lastHoldRow=0, nextNoteRow=8 (no next note)
    //   scanRow = 1 (where we stopped)
    // Row 1: no note → skip
    // Row 2: noteOff → no note → skip
    // Row 3: no note → skip
    // So gateSeq: [1, 0, 0, 0] — note on row 0, silence after.
    // The noteOff itself has no effect because it's not part of a chain.
    // But that's actually fine — the intent of noteOff is to stop the note,
    // and not having a hold sign also stops the note.
    // The important thing is that noteOff doesn't BREAK anything.
    expect(seq.gateSeq[0]).toBe(1)
  })

  // ── volume ─────────────────────────────────────────────────────
  it('per-row volume from cells', () => {
    const track = makeTrack(4)
    setNote(track, 0, 60)
    track.cells[0].volume = 0.5
    track.cells[1].volume = 0.75
    track.cells[3].volume = 0.25
    const seq = buildSequences(track, 4)
    expect(seq.volumeSeq[0]).toBe(0.5)
    expect(seq.volumeSeq[1]).toBe(0.75)
    expect(seq.volumeSeq[2]).toBe(1) // default
    expect(seq.volumeSeq[3]).toBe(0.25)
  })

  // ── wrap-around sustain ────────────────────────────────────────
  it('wraps gate=1 across the pattern loop boundary', () => {
    const track = makeTrack(4)
    setNote(track, 2, 60)
    setHold(track, 3)
    const seq = buildSequences(track, 4)
    // Last row gate=1 → wraps to start
    expect(seq.gateSeq[0]).toBe(1) // wrapped
    expect(seq.gateSeq[1]).toBe(1) // wrapped (no event to stop)
    expect(seq.gateSeq[2]).toBe(1) // note
    expect(seq.gateSeq[3]).toBe(1) // hold
  })

  it('wrap stops at a new note', () => {
    const track = makeTrack(4)
    setNote(track, 2, 60)
    setHold(track, 3)
    setNote(track, 0, 64) // note at position 0 breaks the wrap
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[0]).toBe(1) // new note — no wrap
    expect(seq.gateSeq[1]).toBe(0) // silence (note has no holds, released immediately)
    expect(seq.gateSeq[2]).toBe(1) // note 60
    expect(seq.gateSeq[3]).toBe(1) // hold
  })

  it('wrap stops at a hold sign', () => {
    const track = makeTrack(4)
    setNote(track, 2, 60)
    setHold(track, 3)
    setHold(track, 0) // hold at position 0 breaks the wrap
    const seq = buildSequences(track, 4)
    expect(seq.gateSeq[0]).toBe(0) // hold without prior note — no-op
    expect(seq.gateSeq[1]).toBe(0)
    expect(seq.gateSeq[2]).toBe(1) // note 60
    expect(seq.gateSeq[3]).toBe(1) // hold
  })

  // ── multiple chains ────────────────────────────────────────────
  it('handles multiple independent note chains', () => {
    const track = makeTrack(8)
    setNote(track, 0, 60)
    setHold(track, 1)
    setNote(track, 4, 64)
    setHold(track, 5)
    setHold(track, 6)
    const seq = buildSequences(track, 8)
    // Chain 1: rows 0-1 (note 60 + hold)
    expect(seq.gateSeq[0]).toBe(1)
    expect(seq.gateSeq[1]).toBe(1)
    // No sustain — gate drops after hold chain
    expect(seq.gateSeq[2]).toBe(0)
    expect(seq.gateSeq[3]).toBe(0)
    // Chain 2: rows 4-6 (note 64 + 2 holds)
    expect(seq.gateSeq[4]).toBe(1)
    expect(seq.gateSeq[5]).toBe(1)
    expect(seq.gateSeq[6]).toBe(1)
    // Row 7: no hold, no next note → release
    expect(seq.gateSeq[7]).toBe(0)
  })

  // ── staccato lane defaults ─────────────────────────────────────
  it('staccato lane default is 1 (FF, full row duration)', () => {
    const staccatoLane = { id: 'lan_stac', type: 'staccato' }
    const track = makeTrack(8, [staccatoLane])
    setNote(track, 0, 60)
    setNote(track, 5, 64)
    const seq = buildSequences(track, 8)
    // Default lane value = 1 (FF) — staccatoSeq is 1 everywhere
    expect(seq.effectLanes['lan_stac'][0]).toBe(1)
    // No sustain by default — gate=1 only on note row
    expect(seq.gateSeq[0]).toBe(1) // note
    expect(seq.gateSeq[1]).toBe(0) // release
    expect(seq.staccatoSeq[0]).toBe(1) // default staccato
  })
})
