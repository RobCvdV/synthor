import type { Patch } from 'immer'
import type { Cell, EffectLaneDef, Id, Instrument } from '../domain/types'

/** One undoable step: forward patches and their inverse. */
export interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
}

/** A detached copy of a track + its instrument, for copy/paste. Stores the full
 *  instrument; paste clones it with fresh ids. */
export interface TrackSnapshot {
  instrument: Instrument
  cells: Cell[]
  effectLanes: EffectLaneDef[]
}

export interface RectClipboard {
  cells: Cell[][]
  /** Effect lane definitions per source track column, so pasting into
   *  a different track/pattern auto-creates matching lanes. */
  trackLanes: EffectLaneDef[][]
}

/** One tracker column, for single-column edits. */
export type CellColumn = { kind: 'note' } | { kind: 'volume' } | { kind: 'lane'; laneId: Id }
