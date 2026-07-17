/**
 * The module registry — pure data describing every module type in one place.
 * No `el`, no React: both the engine (input gathering, param lookup) and the
 * React Flow editor (handles + sliders) read this. Adding a new module type is
 * a new entry here plus one compile case in `engine/modular.ts`.
 */

import type { ModuleType } from './types'

/** A tweakable knob on a module. `enumLabels` marks a discrete selector. */
export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  default: number
  step: number
  /** When set, the param is a discrete choice; index into these labels. */
  enumLabels?: string[]
}

export interface ModuleDef {
  type: ModuleType
  label: string
  /** Named inlets (left side). Sources (note/gate) have none. */
  inlets: string[]
  /** Named outlets (right side). The output sink has none. */
  outlets: string[]
  params: ParamDef[]
  /** Sources and the output sink are singletons the user can't add/delete. */
  singleton?: boolean
}

/** Waveform selector values for the oscillator. */
export const WAVEFORMS = ['saw', 'square', 'triangle', 'sine', 'pulse'] as const
/** LFO waveform selector — all shapes, ordered so old sine/triangle patches
 *  keep their index (0=sine, 1=triangle, then the rest). */
export const LFO_WAVEFORMS = ['sine', 'triangle', 'saw', 'square', 'pulse'] as const
/** Filter mode selector values. */
export const FILTER_MODES = ['lowpass', 'highpass', 'bandpass'] as const
/** Mix combine modes. */
export const MIX_MODES = ['add', 'multiply'] as const

export const MODULE_DEFS: Record<ModuleType, ModuleDef> = {
  note: {
    type: 'note',
    label: 'Note',
    inlets: [],
    outlets: ['freq'],
    params: [],
    singleton: true,
  },
  gate: {
    type: 'gate',
    label: 'Gate',
    inlets: [],
    outlets: ['gate'],
    params: [],
    singleton: true,
  },
  volume: {
    type: 'volume',
    label: 'Volume',
    inlets: [],
    outlets: ['vol'],
    params: [],
    singleton: true,
  },
  osc: {
    type: 'osc',
    label: 'Oscillator',
    inlets: ['freq'],
    outlets: ['out'],
    params: [
      { key: 'waveform', label: 'Wave', min: 0, max: 4, default: 0, step: 1, enumLabels: [...WAVEFORMS] },
      { key: 'detune', label: 'Detune (st)', min: -24, max: 24, default: 0, step: 1 },
      { key: 'finetune', label: 'Fine (ct)', min: -100, max: 100, default: 0, step: 1 },
      { key: 'pulseWidth', label: 'Width', min: 0.05, max: 0.95, default: 0.5, step: 0.01 },
      { key: 'gain', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  filter: {
    type: 'filter',
    label: 'Filter',
    inlets: ['in', 'cutoffMod'],
    outlets: ['out'],
    params: [
      { key: 'mode', label: 'Mode', min: 0, max: 2, default: 0, step: 1, enumLabels: [...FILTER_MODES] },
      { key: 'cutoff', label: 'Cutoff (Hz)', min: 20, max: 18000, default: 1200, step: 1 },
      { key: 'q', label: 'Resonance', min: 0.1, max: 12, default: 0.7, step: 0.1 },
      { key: 'modDepth', label: 'Mod depth', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  adsr: {
    type: 'adsr',
    label: 'ADSR',
    inlets: ['gate'],
    outlets: ['env'],
    params: [
      { key: 'attack', label: 'Attack (s)', min: 0.001, max: 2, default: 0.005, step: 0.001 },
      { key: 'decay', label: 'Decay (s)', min: 0.001, max: 2, default: 0.12, step: 0.001 },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1, default: 0.7, step: 0.01 },
      { key: 'release', label: 'Release (s)', min: 0.001, max: 3, default: 0.25, step: 0.001 },
    ],
  },
  gain: {
    type: 'gain',
    label: 'Gain',
    inlets: ['in', 'mod'],
    outlets: ['out'],
    params: [{ key: 'level', label: 'Level', min: 0, max: 2, default: 0.8, step: 0.01 }],
  },
  mix: {
    type: 'mix',
    label: 'Mix',
    inlets: ['a', 'b', 'c', 'd'],
    outlets: ['out'],
    params: [{ key: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1, enumLabels: [...MIX_MODES] }],
  },
  lfo: {
    type: 'lfo',
    label: 'LFO',
    inlets: ['gate'],
    outlets: ['out'],
    params: [
      { key: 'waveform', label: 'Wave', min: 0, max: 4, default: 0, step: 1, enumLabels: [...LFO_WAVEFORMS] },
      { key: 'rate', label: 'Rate (Hz)', min: 0.1, max: 50, default: 4, step: 0.1 },
      { key: 'amount', label: 'Amount', min: 0, max: 1, default: 1, step: 0.01 },
      { key: 'pulseWidth', label: 'Width', min: 0.05, max: 0.95, default: 0.5, step: 0.01 },
      { key: 'sync', label: 'Sync', min: 0, max: 1, default: 0, step: 1, enumLabels: ['free', 'gate'] },
    ],
  },
  tanh: {
    type: 'tanh',
    label: 'Distortion',
    inlets: ['in'],
    outlets: ['out'],
    params: [
      { key: 'drive', label: 'Drive', min: 1, max: 20, default: 3, step: 0.5 },
      { key: 'level', label: 'Level', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  delay: {
    type: 'delay',
    label: 'Delay',
    inlets: ['in'],
    outlets: ['out'],
    params: [
      { key: 'time', label: 'Time (ms)', min: 1, max: 2000, default: 150, step: 1 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  echo: {
    type: 'echo',
    label: 'Echo',
    inlets: ['in'],
    outlets: ['out'],
    params: [
      { key: 'time', label: 'Time (ms)', min: 1, max: 2000, default: 150, step: 1 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.25, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  reverb: {
    type: 'reverb',
    label: 'Reverb',
    inlets: ['in'],
    outlets: ['outL', 'outR'],
    params: [
      { key: 'roomSize', label: 'Room', min: 0.1, max: 1, default: 0.5, step: 0.01 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.45, step: 0.01 },
      { key: 'damping', label: 'Damping', min: 0, max: 1, default: 0.5, step: 0.01 },
      { key: 'stereoWidth', label: 'Width', min: 0, max: 1, default: 0.6, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.35, step: 0.01 },
    ],
  },
  sample: {
    type: 'sample',
    label: 'Sample',
    inlets: ['gate', 'freq'],
    outlets: ['out', 'outR'],
    params: [
      { key: 'sampleIndex', label: 'Sample', min: 0, max: 0, default: 0, step: 1 },
      // max and enumLabels are populated dynamically from entities.samples
      { key: 'startOffset', label: 'Start (smp)', min: 0, max: 1_000_000, default: 0, step: 1 },
      { key: 'loop', label: 'Loop', min: 0, max: 1, default: 0, step: 1, enumLabels: ['off', 'on'] },
      { key: 'loopStart', label: 'Loop start', min: 0, max: 1_000_000, default: 0, step: 1 },
      { key: 'pitchTrack', label: 'Pitch track', min: 0, max: 1, default: 0, step: 1, enumLabels: ['off', 'on'] },
      { key: 'centerNote', label: 'Root note', min: 0, max: 127, default: 60, step: 1 },
      { key: 'gain', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  output: {
    type: 'output',
    label: 'Output',
    inlets: ['inL', 'inR'],
    outlets: [],
    params: [
      { key: 'gain', label: 'Volume', min: 0, max: 2, default: 1, step: 0.01 },
    ],
    singleton: true,
  },
}

/** Default param map for a freshly created module of the given type. */
export function defaultParams(type: ModuleType): Record<string, number> {
  const params: Record<string, number> = {}
  for (const p of MODULE_DEFS[type].params) params[p.key] = p.default
  return params
}
