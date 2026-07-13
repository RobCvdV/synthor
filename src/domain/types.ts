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

/** The original built-in instrument: a simple saw oscillator through an ADSR. */
export interface OscInstrument {
  id: Id
  kind: 'osc'
  name: string
  params: {
    /** Output gain, 0..1. */
    gain: number
  }
}

/**
 * A modular instrument: a graph of `modules` wired by `connections`. Compiles
 * to an Elementary node exactly like an osc instrument, so the tracker never
 * needs to know the difference. Kept fully serializable (plain data + numbers).
 */
export type ModuleType =
  | 'note' // source: the track's per-row frequency (Hz)
  | 'gate' // source: the track's per-row gate (0/1)
  | 'osc' // oscillator (saw/square/triangle/sine)
  | 'filter' // state-variable filter (lp/hp/bp)
  | 'adsr' // envelope generator
  | 'gain' // multiply a signal by a level (and/or a modulation inlet)
  | 'mix' // combine several signals (add or multiply)
  | 'output' // the voice's final output tap

/** An address into a module's inlet or outlet, by name. */
export interface Port {
  moduleId: Id
  /** Inlet/outlet name as declared in the module registry (`moduleDefs`). */
  port: string
}

/** One block in a modular instrument. `params` keys come from the registry. */
export interface Module {
  id: Id
  type: ModuleType
  params: Record<string, number>
  /** React Flow canvas position; persisted so layouts survive save/load. */
  pos: { x: number; y: number }
}

/** A patch cord from one module's outlet to another's inlet. */
export interface Connection {
  id: Id
  from: Port
  to: Port
  /** Per-cord "impact" knob: the source is scaled by this before summing. */
  gain: number
}

export interface ModularInstrument {
  id: Id
  kind: 'modular'
  name: string
  modules: Record<Id, Module>
  connections: Record<Id, Connection>
  /** The module whose inlet feeds the voice output (always type 'output'). */
  outputId: Id
}

export type Instrument = OscInstrument | ModularInstrument

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
