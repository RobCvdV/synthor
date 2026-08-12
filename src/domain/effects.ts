/**
 * Effect lane definitions — pure data, no dependencies.
 *
 * Each track can have zero or more effect lanes. Each lane has a type
 * (either a built-in effect or a named instrument inlet) and a per-step
 * 2-hex-digit value (00–FF, normalized 0–1).
 *
 * Built-in lane types are processed by the engine into freqMul/volMod/pan
 * modulation signals. Named instrument inlets pass the raw per-step value
 * directly into the modular synth graph via `eff` source modules.
 */

import type { Instrument } from './types'

/** Built-in lane type constants. */
export const BUILTIN_LANE_TYPES = [
  'vibratoRate',
  'vibratoDepth',
  'tremoloRate',
  'tremoloDepth',
  'portamento',
  'volumeSlide',
  'panning',
  'staccato',
] as const

export type BuiltinLaneType = typeof BUILTIN_LANE_TYPES[number]

export interface LaneDef {
  type: BuiltinLaneType
  label: string
  description: string
}

/** Registry of built-in effect lane types. */
export const LANE_DEFS: Record<BuiltinLaneType, LaneDef> = {
  vibratoRate:  { type: 'vibratoRate',  label: 'Vib Rate',  description: 'Vibrato LFO speed (0.5–50 Hz)' },
  vibratoDepth: { type: 'vibratoDepth', label: 'Vib Depth', description: 'Vibrato modulation depth' },
  tremoloRate:  { type: 'tremoloRate',  label: 'Trm Rate',  description: 'Tremolo LFO speed (0.5–50 Hz)' },
  tremoloDepth: { type: 'tremoloDepth', label: 'Trm Depth', description: 'Tremolo modulation depth' },
  portamento:   { type: 'portamento',   label: 'Porta',     description: 'Pitch slide (80=center, 00=down, FF=up)' },
  volumeSlide:  { type: 'volumeSlide',  label: 'Vol Slide', description: 'Absolute volume to slide to (00–FF)' },
  panning:      { type: 'panning',      label: 'Panning',   description: 'Stereo position (00=left, FF=right)' },
  staccato:     { type: 'staccato',     label: 'Staccato',  description: 'Note cut timing (00=immediate, FF=legato)' },
}

/** Check whether a lane type string is a built-in type. */
export function isBuiltinLaneType(type: string): type is BuiltinLaneType {
  return (BUILTIN_LANE_TYPES as readonly string[]).includes(type)
}

/**
 * Named instrument inlets available as effect-lane types — the names of the
 * instrument's `eff` modules. Unnamed eff modules aren't addressable by a
 * lane, so they're excluded. Duplicate names are collapsed (two modules
 * sharing a name are driven by the same lane).
 */
export function effInletNames(inst: Instrument | undefined): string[] {
  if (!inst || inst.kind !== 'modular') return []
  const names: string[] = []
  for (const m of Object.values(inst.modules)) {
    if (m.type === 'eff' && m.name && !names.includes(m.name)) names.push(m.name)
  }
  return names
}

/** Human-readable label for any lane type (built-in or named inlet). */
export function readableLaneLabel(type: string): string {
  if (isBuiltinLaneType(type)) return LANE_DEFS[type].label
  return type // named inlet — return the name as-is
}

/** Format a value 0..1 as a tracker-style 2-digit hex string. */
export function valueHex(v: number | null): string {
  if (v === null) return '··'
  const hex = Math.round(v * 255).toString(16).toUpperCase()
  return hex.length === 1 ? '0' + hex : hex
}
