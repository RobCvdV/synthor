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
  /** When true, an integer scale factor is shown as +/- buttons next to the
   *  slider value. The scale value is stored in a companion param with the
   *  suffix `Scale` (e.g. `modDepthScale` augments `modDepth`). */
  showScale?: boolean
}

/** Palette category shown in the editor's Add palette. Singleton types
 *  (note/gate/volume/midicc/output) never appear there, so they have none. */
export type ModuleGroup = 'sources' | 'generators' | 'shaping' | 'distortion' | 'time'

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
  /** Palette group. Required for every non-singleton type. */
  group?: ModuleGroup
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
/** Max sample length usable as a single-cycle waveform. One full sample = one cycle. */
export const WAVEFORM_MAX_LENGTH_SECONDS = 0.25

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
  eff: {
    type: 'eff',
    group: 'sources',
    label: 'Eff In',
    inlets: [],
    outlets: ['val'],
    params: [
      { key: 'cc', label: 'CC', min: 0, max: 127, default: 0, step: 1 },
      // Value when no effect lane (or MIDI CC) drives this inlet.
      { key: 'default', label: 'Default', min: 0, max: 1, default: 0, step: 0.01 },
    ],
  },
  midicc: {
    type: 'midicc',
    group: 'sources',
    label: 'MIDI CC',
    inlets: [],
    outlets: ['val'],
    params: [{ key: 'cc', label: 'CC', min: 0, max: 127, default: 1, step: 1 }],
  },
  osc: {
    type: 'osc',
    group: 'generators',
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
  noise: {
    type: 'noise',
    group: 'generators',
    label: 'Noise',
    inlets: [],
    outlets: ['out'],
    params: [
      { key: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1, enumLabels: ['normal', 'pink'] },
      { key: 'level', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  filter: {
    type: 'filter',
    group: 'shaping',
    label: 'Filter',
    inlets: ['in', 'cutoffMod'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'mode', label: 'Mode', min: 0, max: 2, default: 0, step: 1, enumLabels: [...FILTER_MODES] },
      { key: 'cutoff', label: 'Cutoff (Hz)', min: 20, max: 18000, default: 1200, step: 1 },
      { key: 'q', label: 'Resonance', min: 0.1, max: 12, default: 0.7, step: 0.1 },
      { key: 'modDepth', label: 'Mod depth', min: 0, max: 1, default: 0.5, step: 0.01, showScale: true },
      { key: 'modDepthScale', label: '×', min: 1, max: 99, default: 1, step: 1 },
    ],
  },
  adsr: {
    type: 'adsr',
    group: 'shaping',
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
    group: 'shaping',
    label: 'Gain',
    inlets: ['in', 'mod'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'level', label: 'Level', min: 0, max: 2, default: 0.8, step: 0.01 },
    ],
  },
  comp: {
    type: 'comp',
    group: 'shaping',
    label: 'Compressor',
    inlets: ['in'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'mode', label: 'Mode', min: 0, max: 1, default: 1, step: 1, enumLabels: ['hard', 'soft'] },
      { key: 'threshold', label: 'Thresh (dB)', min: -60, max: 0, default: -20, step: 1 },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, step: 1 },
      { key: 'attack', label: 'Attack (ms)', min: 1, max: 100, default: 10, step: 1 },
      { key: 'release', label: 'Release (ms)', min: 10, max: 1000, default: 100, step: 1 },
      { key: 'knee', label: 'Knee (dB)', min: 0, max: 24, default: 6, step: 1 },
      { key: 'makeup', label: 'Makeup (dB)', min: 0, max: 24, default: 0, step: 1 },
    ],
  },
  mix: {
    type: 'mix',
    group: 'shaping',
    label: 'Mix',
    inlets: ['a', 'b', 'c', 'd'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1, enumLabels: [...MIX_MODES] },
    ],
  },
  lfo: {
    type: 'lfo',
    group: 'generators',
    label: 'LFO',
    inlets: ['gate'],
    outlets: ['out'],
    params: [
      { key: 'waveform', label: 'Wave', min: 0, max: 4, default: 0, step: 1, enumLabels: [...LFO_WAVEFORMS] },
      { key: 'rate', label: 'Rate (Hz)', min: 0.1, max: 50, default: 4, step: 0.1 },
      { key: 'amount', label: 'Amount', min: 0, max: 1, default: 1, step: 0.01, showScale: true },
      { key: 'amountScale', label: '×', min: 1, max: 99, default: 1, step: 1 },
      { key: 'pulseWidth', label: 'Width', min: 0.05, max: 0.95, default: 0.5, step: 0.01 },
      { key: 'sync', label: 'Sync', min: 0, max: 1, default: 0, step: 1, enumLabels: ['free', 'gate'] },
    ],
  },
  tanh: {
    type: 'tanh',
    group: 'distortion',
    label: 'Saturator',
    inlets: ['in', 'drive'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'drive', label: 'Drive', min: 0.5, max: 40, default: 4, step: 0.5 },
      { key: 'level', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  clip: {
    type: 'clip',
    group: 'distortion',
    label: 'Hard Clip',
    inlets: ['in', 'drive'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'drive', label: 'Drive', min: 0.5, max: 40, default: 4, step: 0.5 },
      { key: 'threshold', label: 'Thresh', min: 0.05, max: 1, default: 0.7, step: 0.01 },
      { key: 'level', label: 'Level', min: 0, max: 2, default: 0.7, step: 0.01 },
    ],
  },
  fold: {
    type: 'fold',
    group: 'distortion',
    label: 'Wave Folder',
    inlets: ['in', 'drive'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'drive', label: 'Drive', min: 0.5, max: 30, default: 3, step: 0.5 },
      { key: 'threshold', label: 'Thresh', min: 0.05, max: 1, default: 0.35, step: 0.01 },
      { key: 'level', label: 'Level', min: 0, max: 2, default: 0.7, step: 0.01 },
    ],
  },
  crush: {
    type: 'crush',
    group: 'distortion',
    label: 'Bit Crusher',
    inlets: ['in', 'bits'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'bits', label: 'Bits', min: 1, max: 16, default: 4, step: 1 },
      { key: 'level', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  delay: {
    type: 'delay',
    group: 'time',
    label: 'Delay',
    inlets: ['in'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      // Tempo-synced: ticks (rows), live with BPM changes.
      { key: 'time', label: 'Time (ticks)', min: 0.25, max: 16, default: 1.25, step: 0.25 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  echo: {
    type: 'echo',
    group: 'time',
    label: 'Echo',
    inlets: ['in'],
    outlets: ['out'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      // Tempo-synced: ticks (rows), live with BPM changes.
      { key: 'time', label: 'Time (ticks)', min: 0.25, max: 16, default: 1.25, step: 0.25 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.25, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  reverb: {
    type: 'reverb',
    group: 'time',
    label: 'Reverb',
    inlets: ['in', 'inR'],
    outlets: ['outL', 'outR'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'roomSize', label: 'Room', min: 0.1, max: 1, default: 0.5, step: 0.01 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.45, step: 0.01 },
      { key: 'damping', label: 'Damping', min: 0, max: 1, default: 0.5, step: 0.01 },
      { key: 'stereoWidth', label: 'Width', min: 0, max: 1, default: 0.6, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.35, step: 0.01 },
    ],
  },
  conv: {
    type: 'conv',
    group: 'time',
    label: 'Convolution',
    inlets: ['in', 'inR'],
    outlets: ['out', 'outL', 'outR'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      { key: 'sampleIndex', label: 'IR Sample', min: 0, max: 0, default: 0, step: 1 },
      // max and enumLabels are populated dynamically from entities.samples
      // Half-dry by default: L1 normalization makes full wet very quiet for
      // most samples, and the dry keeps the channel audible.
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
      // L1 normalization keeps wet ≤ dry peak; gain restores loudness for quiet IRs.
      { key: 'gain', label: 'Gain', min: 0, max: 32, default: 1, step: 0.01 },
      // Stereo widening of the wet pair; >1 adds Haas pseudo-stereo.
      { key: 'width', label: 'Width', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  delayS: {
    type: 'delayS',
    group: 'time',
    label: 'Stereo Delay',
    inlets: ['in', 'inR'],
    outlets: ['outL', 'outR'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      // Tempo-synced: ticks (rows), live with BPM changes.
      { key: 'time', label: 'Time (ticks)', min: 0.25, max: 16, default: 1.25, step: 0.25 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
      // 0 = per-channel repeats, 1 = repeats bounce between L and R.
      { key: 'pingpong', label: 'Ping-Pong', min: 0, max: 1, default: 0, step: 0.01 },
    ],
  },
  echoS: {
    type: 'echoS',
    group: 'time',
    label: 'Stereo Echo',
    inlets: ['in', 'inR'],
    outlets: ['outL', 'outR'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      // Tempo-synced: ticks (rows), live with BPM changes.
      { key: 'time', label: 'Time (ticks)', min: 0.25, max: 16, default: 1.25, step: 0.25 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.25, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
      // 0 = per-channel repeats, 1 = repeats bounce between L and R.
      { key: 'pingpong', label: 'Ping-Pong', min: 0, max: 1, default: 0, step: 0.01 },
    ],
  },
  width: {
    type: 'width',
    group: 'shaping',
    label: 'Stereo Width',
    inlets: ['in', 'inR'],
    outlets: ['outL', 'outR'],
    params: [
      { key: 'bypass', label: 'Bypass', min: 0, max: 1, default: 0, step: 1, enumLabels: ['on', 'off'] },
      // >1 adds Haas pseudo-stereo, so even mono sources spread out.
      { key: 'width', label: 'Width', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  sample: {
    type: 'sample',
    group: 'generators',
    label: 'Sample',
    inlets: ['gate', 'freq'],
    outlets: ['out', 'outR'],
    params: [
      { key: 'sampleIndex', label: 'Sample', min: 0, max: 0, default: 0, step: 1 },
      // max and enumLabels are populated dynamically from entities.samples
      { key: 'startOffset', label: 'Start (smp)', min: 0, max: 1_000_000, default: 0, step: 1 },
      { key: 'loop', label: 'Loop', min: 0, max: 1, default: 0, step: 1, enumLabels: ['off', 'on'] },
      { key: 'loopStart', label: 'Loop start', min: 0, max: 1_000_000, default: 0, step: 1 },
      { key: 'pitchTrack', label: 'Pitch track', min: 0, max: 1, default: 1, step: 1, enumLabels: ['off', 'on'] },
      { key: 'playRate', label: 'Play rate', min: -48, max: 48, default: 0, step: 1 },
      { key: 'finetune', label: 'Finetune', min: -1, max: 1, default: 0, step: 0.01 },
      { key: 'gain', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 },
    ],
  },
  wave: {
    type: 'wave',
    group: 'generators',
    label: 'Sample Waveform',
    inlets: ['freq'],
    outlets: ['out', 'outR'],
    params: [
      { key: 'sampleIndex', label: 'Sample', min: 0, max: 0, default: 0, step: 1 },
      // max and enumLabels are populated dynamically from entities.samples,
      // filtered to samples ≤ WAVEFORM_MAX_LENGTH_SECONDS.
      { key: 'finetune', label: 'Fine (ct)', min: -100, max: 100, default: 0, step: 1 },
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

/** Module types that are valid as channel effects (signal processors, not sources/sinks). */
export const EFFECT_MODULE_TYPES: ModuleType[] = [
  'filter',
  'delay',
  'echo',
  'delayS',
  'echoS',
  'reverb',
  'conv',
  'width',
  'tanh',
  'clip',
  'fold',
  'crush',
  'gain',
  'comp',
]

/** Check whether a module type can be used as a channel effect. */
export function isEffectModule(type: ModuleType): boolean {
  return (EFFECT_MODULE_TYPES as readonly string[]).includes(type)
}

/** Mono effects process one channel at a time — they get instantiated twice (L+R) on stereo channels. */
const STEREO_EFFECT_TYPES: ModuleType[] = ['reverb', 'delay', 'echo', 'delayS', 'echoS', 'comp', 'width', 'conv']

export function isStereoEffect(type: ModuleType): boolean {
  return (STEREO_EFFECT_TYPES as readonly string[]).includes(type)
}

/** Default param map for a freshly created module of the given type. */
export function defaultParams(type: ModuleType): Record<string, number> {
  const params: Record<string, number> = {}
  for (const p of MODULE_DEFS[type].params) params[p.key] = p.default
  return params
}
