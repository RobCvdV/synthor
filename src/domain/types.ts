/**
 * Domain model — pure, serializable data. No React, no Zustand, no audio.
 *
 * Everything is normalized into entity maps keyed by id so that higher-level
 * structures (sections, songs) can reference patterns/tracks by id and reuse
 * them without copying. The vertical slice only exercises instruments +
 * patterns + tracks; sections/songs and vol/eff lanes slot in later without a
 * rewrite.
 */

export type Id = string

/** A single step in a track lane. For the slice, only `note` exists. */
export interface Cell {
  /** MIDI note number (60 = C4), or null for an empty step. */
  note: number | null
}

/** For now the only instrument kind is a simple saw oscillator. */
export interface Instrument {
  id: Id
  kind: 'osc'
  name: string
  params: {
    /** Output gain, 0..1. */
    gain: number
  }
}

export interface Track {
  id: Id
  instrumentId: Id
  /** One cell per pattern row. Length is kept in sync with the owning pattern. */
  cells: Cell[]
}

export interface Pattern {
  id: Id
  name: string
  /** The pattern owns the length of all its tracks. */
  length: number
  trackIds: Id[]
}

export interface Entities {
  instruments: Record<Id, Instrument>
  tracks: Record<Id, Track>
  patterns: Record<Id, Pattern>
}

/** The full editable document. Serializable as-is to JSON. */
export interface Doc {
  entities: Entities
  /** The pattern currently open in the editor. */
  patternId: Id
}
