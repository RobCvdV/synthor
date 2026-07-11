import type { Cell, Doc, Instrument, Pattern, Track } from './types'

let counter = 0
/** Deterministic-enough id for a single session. Not for persistence keys. */
export function makeId(prefix: string): string {
  counter += 1
  return `${prefix}_${counter}`
}

export function emptyCells(length: number): Cell[] {
  return Array.from({ length }, () => ({ note: null }))
}

/** Fit a cell list to a target length: truncate if longer, pad empty if shorter. */
export function fitCells(cells: Cell[], length: number): Cell[] {
  const out = cells.slice(0, length).map((c) => ({ ...c }))
  while (out.length < length) out.push({ note: null })
  return out
}

/** A fresh saw instrument. */
export function newOscInstrument(name: string): Instrument {
  return { id: makeId('inst'), kind: 'osc', name, params: { gain: 0.8 } }
}

/** A fresh empty track bound to an instrument. */
export function newTrack(instrumentId: string, length: number): Track {
  return { id: makeId('trk'), instrumentId, cells: emptyCells(length) }
}

/**
 * A minimal starter document: one 16-row pattern, two saw tracks, with a few
 * notes already placed so playback makes sound the moment you hit play.
 */
export function createDefaultDoc(): Doc {
  const instA: Instrument = { id: makeId('inst'), kind: 'osc', name: 'Saw Lead', params: { gain: 0.8 } }
  const instB: Instrument = { id: makeId('inst'), kind: 'osc', name: 'Saw Bass', params: { gain: 0.8 } }

  const length = 16

  const trackA: Track = { id: makeId('trk'), instrumentId: instA.id, cells: emptyCells(length) }
  const trackB: Track = { id: makeId('trk'), instrumentId: instB.id, cells: emptyCells(length) }

  // A simple arpeggio on track A (C4 E4 G4 C5 pattern every 4 rows).
  const arp = [60, 64, 67, 72]
  for (let row = 0; row < length; row += 4) {
    trackA.cells[row].note = arp[(row / 4) % arp.length]
  }
  // A root-note bass on track B every 8 rows (C2 / G2).
  trackB.cells[0].note = 36
  trackB.cells[8].note = 43

  const pattern: Pattern = {
    id: makeId('pat'),
    name: 'Pattern 01',
    length,
    trackIds: [trackA.id, trackB.id],
  }

  return {
    entities: {
      instruments: { [instA.id]: instA, [instB.id]: instB },
      tracks: { [trackA.id]: trackA, [trackB.id]: trackB },
      patterns: { [pattern.id]: pattern },
    },
    patternId: pattern.id,
  }
}
