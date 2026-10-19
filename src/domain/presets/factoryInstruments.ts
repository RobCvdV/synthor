/**
 * The factory instruments seeded into a new library: synth-only patches covering basses, leads,
 * pads, keys, plucks and drums for common electronic styles. Effects (reverb, delay) are left to
 * the mixer channels, so voices stay cheap.
 */
import type { ModularInstrument } from '../types'
import { buildPatch, type ModuleRef, type PatchBuilder, type PortRef } from './patchBuilder'

export interface FactoryInstrument {
  /** Stable library folder name. */
  id: string
  category: string
  tags: string[]
  build(): ModularInstrument
}

// Module param enums, by index.
const SAW = 0
const SQUARE = 1
const TRIANGLE = 2
const SINE = 3
const PULSE = 4
const LOWPASS = 0
const HIGHPASS = 1
const BANDPASS = 2
const MULTIPLY = 1

/** An ADSR driven by the voice's gate. */
function env(b: PatchBuilder, attack: number, decay: number, sustain: number, release: number): ModuleRef {
  const e = b.add('adsr', { attack, decay, sustain, release })
  b.wire(b.gate, e, 'gate')
  return e
}

/** `src` through a gain shaped by `envelope`. */
function vca(b: PatchBuilder, src: ModuleRef, envelope: ModuleRef, level = 1): ModuleRef {
  const g = b.add('gain', { level })
  b.wire(src, g, 'in')
  b.wire(envelope, g, 'mod')
  return g
}

/** An oscillator tracking the played note. */
function osc(b: PatchBuilder, params: Record<string, number>): ModuleRef {
  const o = b.add('osc', params)
  b.wire(b.note, o, 'freq')
  return o
}

/** Sums `sources` (up to four) through a mix module. */
function mix(b: PatchBuilder, ...sources: ModuleRef[]): ModuleRef {
  const m = b.add('mix')
  sources.forEach((s, i) => b.wire(s, m, 'abcd'[i]))
  return m
}

function toOutput(b: PatchBuilder, left: ModuleRef | PortRef, right?: ModuleRef | PortRef): void {
  b.wire(left, b.output, 'inL')
  if (right) b.wire(right, b.output, 'inR')
}

/** Mono `src` spread to both outputs through a stereo-width module. */
function widen(b: PatchBuilder, src: ModuleRef, width: number): void {
  const w = b.add('width', { width })
  b.wire(src, w, 'in')
  b.wire(src, w, 'inR')
  toOutput(b, w.port('outL'), w.port('outR'))
}

const patch = (id: string, name: string, category: string, tags: string[], opts: { voices?: number; level?: number }, body: (b: PatchBuilder) => void): FactoryInstrument =>
  ({ id, category, tags, build: () => buildPatch(id, name, opts, body) })

export const FACTORY_INSTRUMENTS: FactoryInstrument[] = [
  // ── Bass ──────────────────────────────────────────────────────────────
  patch('acid-bass', 'Acid Bass', 'Bass', ['acid', 'techno', '303', 'mono'], { voices: 1, level: 0.82 }, (b) => {
    const o = osc(b, { waveform: SAW })
    const f = b.add('filter', { mode: LOWPASS, cutoff: 180, q: 9, modDepth: 1, modDepthScale: 18 })
    b.wire(o, f, 'in')
    b.wire(env(b, 0.002, 0.2, 0, 0.1), f, 'cutoffMod')
    // A tracker lane opens the filter further, the classic acid tweak.
    b.wire(b.add('eff', { default: 0.3 }, 'Cutoff'), f, 'cutoffMod', 0.6)
    const drive = b.add('tanh', { drive: 2, level: 0.8 })
    b.wire(f, drive, 'in')
    toOutput(b, vca(b, drive, env(b, 0.002, 0.3, 0.7, 0.05)))
  }),
  patch('sub-bass', 'Sub Bass', 'Bass', ['dnb', 'dubstep', 'trap', 'deep', 'mono'], { voices: 1, level: 0.5 }, (b) => {
    const sine = osc(b, { waveform: SINE })
    const tri = osc(b, { waveform: TRIANGLE, gain: 0.3 })
    const sat = b.add('tanh', { drive: 1.5, level: 0.9 })
    b.wire(mix(b, sine, tri), sat, 'in')
    const f = b.add('filter', { mode: LOWPASS, cutoff: 400, q: 0.7 })
    b.wire(sat, f, 'in')
    toOutput(b, vca(b, f, env(b, 0.005, 0.1, 1, 0.12)))
  }),
  patch('reese-bass', 'Reese Bass', 'Bass', ['dnb', 'neurofunk', 'dark', 'mono'], { voices: 1, level: 0.58 }, (b) => {
    const a = osc(b, { waveform: SAW, finetune: -14, gain: 0.6 })
    const c = osc(b, { waveform: SAW, finetune: 14, gain: 0.6 })
    const sub = osc(b, { waveform: SAW, detune: -12, gain: 0.4 })
    const f = b.add('filter', { mode: LOWPASS, cutoff: 700, q: 1.2, modDepth: 0.35 })
    b.wire(mix(b, a, c, sub), f, 'in')
    const lfo = b.add('lfo', { rate: 0.3 })
    b.wire(lfo, f, 'cutoffMod')
    const drive = b.add('tanh', { drive: 2.5, level: 0.7 })
    b.wire(f, drive, 'in')
    toOutput(b, vca(b, drive, env(b, 0.005, 0.2, 1, 0.15)))
  }),
  patch('analog-bass', 'Analog Bass', 'Bass', ['house', 'funk', 'disco', 'mono'], { voices: 1, level: 0.92 }, (b) => {
    const sq = osc(b, { waveform: SQUARE, gain: 0.6 })
    const saw = osc(b, { waveform: SAW, detune: -12, gain: 0.6 })
    const f = b.add('filter', { mode: LOWPASS, cutoff: 300, q: 3, modDepth: 1, modDepthScale: 8 })
    b.wire(mix(b, sq, saw), f, 'in')
    b.wire(env(b, 0.002, 0.25, 0.15, 0.1), f, 'cutoffMod')
    toOutput(b, vca(b, f, env(b, 0.002, 0.4, 0.6, 0.08)))
  }),
  patch('fm-bass', 'FM Bass', 'Bass', ['electro', 'synthwave', 'fm', 'mono'], { voices: 1, level: 0.62 }, (b) => {
    const carrier = b.add('dxop', { ratio: 1 })
    const mod = b.add('dxop', { ratio: 1, feedback: 0.2, level: 2 })
    // The modulation index decays with the note: bright attack, round tail.
    b.wire(vca(b, mod, env(b, 0.001, 0.3, 0.3, 0.1), 2), carrier, 'mod', 1.25)
    toOutput(b, vca(b, carrier, env(b, 0.002, 0.5, 0.7, 0.1)))
  }),
  patch('wobble-bass', 'Wobble Bass', 'Bass', ['dubstep', 'riddim', 'wobble', 'mono'], { voices: 1, level: 0.62 }, (b) => {
    const a = osc(b, { waveform: SAW, gain: 0.5 })
    const c = osc(b, { waveform: SAW, finetune: 10, gain: 0.5 })
    const sq = osc(b, { waveform: SQUARE, detune: -12, gain: 0.5 })
    const f = b.add('filter', { mode: LOWPASS, cutoff: 1200, q: 6, modDepth: 0.9 })
    b.wire(mix(b, a, c, sq), f, 'in')
    // LFO × "Wobble" lane: 0 holds the filter still, 1 is a full wobble.
    const lfo = b.add('lfo', { rate: 2.5, sync: 1 })
    b.wire(b.gate, lfo, 'gate')
    const depth = b.add('mix', { mode: MULTIPLY })
    b.wire(lfo, depth, 'a')
    b.wire(b.add('eff', { default: 1 }, 'Wobble'), depth, 'b')
    b.wire(depth, f, 'cutoffMod')
    const drive = b.add('tanh', { drive: 3, level: 0.6 })
    b.wire(f, drive, 'in')
    toOutput(b, vca(b, drive, env(b, 0.003, 0.2, 1, 0.1)))
  }),

  // ── Lead ──────────────────────────────────────────────────────────────
  patch('supersaw-lead', 'Supersaw Lead', 'Lead', ['trance', 'edm', 'uplifting', 'stereo'], { level: 0.8 }, (b) => {
    const amp = env(b, 0.01, 0.3, 0.8, 0.4)
    const side = (detunes: number[]) => {
      const f = b.add('filter', { mode: LOWPASS, cutoff: 7000, q: 0.7 })
      b.wire(mix(b, ...detunes.map((finetune) => osc(b, { waveform: SAW, finetune, gain: 0.5 }))), f, 'in')
      return vca(b, f, amp)
    }
    toOutput(b, side([-17, 6]), side([-6, 17]))
  }),
  patch('chip-lead', 'Chip Lead', 'Lead', ['chiptune', '8-bit', 'retro', 'game'], { level: 0.56 }, (b) => {
    const o = osc(b, { waveform: PULSE, pulseWidth: 0.25 })
    const vibrato = b.add('lfo', { rate: 6, amount: 0.004 })
    b.wire(vibrato, o, 'fm')
    toOutput(b, vca(b, o, env(b, 0.001, 0.05, 0.8, 0.05), 0.8))
  }),
  patch('hard-lead', 'Hard Lead', 'Lead', ['electro', 'hardstyle', 'distorted', 'big room'], { level: 0.6 }, (b) => {
    const saw = osc(b, { waveform: SAW })
    const sq = osc(b, { waveform: SQUARE, finetune: 8, gain: 0.8 })
    const up = osc(b, { waveform: SAW, detune: 12, gain: 0.4 })
    const drive = b.add('tanh', { drive: 6, level: 0.6 })
    b.wire(mix(b, saw, sq, up), drive, 'in')
    const f = b.add('filter', { mode: LOWPASS, cutoff: 4500, q: 2 })
    b.wire(drive, f, 'in')
    toOutput(b, vca(b, f, env(b, 0.003, 0.2, 0.85, 0.2)))
  }),

  // ── Pad ───────────────────────────────────────────────────────────────
  patch('warm-pad', 'Warm Pad', 'Pad', ['ambient', 'chill', 'downtempo', 'stereo'], { voices: 6, level: 0.84 }, (b) => {
    const amp = env(b, 1.2, 1, 0.8, 2.5)
    const lfo = b.add('lfo', { rate: 0.15, amount: 0.4 })
    const center = osc(b, { waveform: SAW, gain: 0.4 })
    const side = (finetune: number) => {
      const f = b.add('filter', { mode: LOWPASS, cutoff: 900, q: 1, modDepth: 1 })
      b.wire(mix(b, osc(b, { waveform: SAW, finetune, gain: 0.5 }), center, osc(b, { waveform: TRIANGLE, detune: 12, gain: 0.25 })), f, 'in')
      b.wire(lfo, f, 'cutoffMod')
      return vca(b, f, amp)
    }
    toOutput(b, side(-10), side(10))
  }),
  patch('string-machine', 'String Machine', 'Pad', ['synthwave', '80s', 'strings', 'stereo'], { voices: 6, level: 0.78 }, (b) => {
    const amp = env(b, 0.35, 0.5, 0.9, 1.2)
    // A slow pitch wobble on one side: the ensemble chorus of old string machines.
    const chorus = b.add('lfo', { rate: 5, amount: 0.003 })
    const side = (finetune: number, wobble: boolean) => {
      const main = osc(b, { waveform: SAW, finetune, gain: 0.5 })
      const octave = osc(b, { waveform: SAW, detune: 12, finetune: -finetune, gain: 0.25 })
      if (wobble) b.wire(chorus, main, 'fm')
      const f = b.add('filter', { mode: LOWPASS, cutoff: 2800, q: 0.7 })
      b.wire(mix(b, main, octave), f, 'in')
      return vca(b, f, amp)
    }
    toOutput(b, side(-7, true), side(7, false))
  }),
  patch('glass-pad', 'Glass Pad', 'Pad', ['ambient', 'fm', 'cinematic', 'stereo'], { voices: 6, level: 0.33 }, (b) => {
    const carrier = b.add('dxop', { ratio: 1 })
    const shimmer = b.add('dxop', { ratio: 2.004, level: 0.4 })
    const mod = b.add('dxop', { ratio: 3 })
    // The FM index fades in with the note, so the tone brightens as it swells.
    const index = vca(b, mod, env(b, 1.5, 1, 1, 2), 1.2)
    b.wire(index, carrier, 'mod')
    b.wire(index, shimmer, 'mod', 0.5)
    widen(b, vca(b, mix(b, carrier, shimmer), env(b, 0.8, 1, 0.85, 2.5)), 1.6)
  }),

  // ── Keys ──────────────────────────────────────────────────────────────
  patch('fm-epiano', 'FM E-Piano', 'Keys', ['lofi', 'house', 'jazz', 'fm', 'stereo'], { voices: 8, level: 0.52 }, (b) => {
    const carrier = b.add('dxop', { ratio: 1 })
    const detuned = b.add('dxop', { ratio: 1.004, level: 0.5 })
    // The tine: a high modulator that only rings at the attack.
    const tine = vca(b, b.add('dxop', { ratio: 14 }), env(b, 0.001, 0.08, 0, 0.05), 1.5)
    const body = vca(b, b.add('dxop', { ratio: 1 }), env(b, 0.001, 1.2, 0.1, 0.3), 1.2)
    b.wire(tine, carrier, 'mod')
    b.wire(body, carrier, 'mod')
    b.wire(body, detuned, 'mod')
    widen(b, vca(b, mix(b, carrier, detuned), env(b, 0.002, 1.6, 0.25, 0.5)), 1.3)
  }),
  patch('house-organ', 'House Organ', 'Keys', ['house', 'garage', '90s', 'organ'], { voices: 8, level: 0.79 }, (b) => {
    // Drawbars: fundamental, octave, twelfth and two octaves up.
    const bars = [[0, 1], [12, 0.7], [19, 0.5], [24, 0.4]].map(([detune, gain]) => osc(b, { waveform: SINE, detune, gain }))
    const sat = b.add('tanh', { drive: 1.5, level: 0.7 })
    b.wire(mix(b, ...bars), sat, 'in')
    toOutput(b, vca(b, sat, env(b, 0.003, 0.25, 0.7, 0.08)))
  }),
  patch('fm-bell', 'FM Bell', 'Keys', ['ambient', 'fm', 'bell', 'chime'], { voices: 8, level: 0.72 }, (b) => {
    const carrier = b.add('dxop', { ratio: 1 })
    const mod = b.add('dxop', { ratio: 3.5 })
    b.wire(vca(b, mod, env(b, 0.001, 2, 0, 2), 2), carrier, 'mod')
    toOutput(b, vca(b, carrier, env(b, 0.001, 2, 0, 2)))
  }),

  // ── Pluck ─────────────────────────────────────────────────────────────
  patch('pluck', 'Pluck', 'Pluck', ['trance', 'house', 'progressive', 'stereo'], { voices: 8, level: 0.82 }, (b) => {
    const a = osc(b, { waveform: SAW, finetune: -8, gain: 0.6 })
    const c = osc(b, { waveform: SAW, finetune: 8, gain: 0.6 })
    const f = b.add('filter', { mode: LOWPASS, cutoff: 400, q: 2, modDepth: 1, modDepthScale: 14 })
    b.wire(mix(b, a, c), f, 'in')
    b.wire(env(b, 0.001, 0.18, 0, 0.1), f, 'cutoffMod')
    widen(b, vca(b, f, env(b, 0.001, 0.45, 0, 0.25)), 1.4)
  }),
  patch('chord-stab', 'Chord Stab', 'Pluck', ['house', 'techno', 'deep house', 'stab'], { voices: 8, level: 0.98 }, (b) => {
    const saw = osc(b, { waveform: SAW, gain: 0.6 })
    const thick = osc(b, { waveform: SAW, finetune: 12, gain: 0.6 })
    const sq = osc(b, { waveform: SQUARE, detune: 12, gain: 0.3 })
    const f = b.add('filter', { mode: LOWPASS, cutoff: 1800, q: 3, modDepth: 1, modDepthScale: 2 })
    b.wire(mix(b, saw, thick, sq), f, 'in')
    b.wire(env(b, 0.001, 0.15, 0, 0.1), f, 'cutoffMod')
    toOutput(b, vca(b, f, env(b, 0.001, 0.22, 0, 0.15)))
  }),

  // ── Drums ─────────────────────────────────────────────────────────────
  patch('synth-kick', 'Synth Kick', 'Drums', ['techno', 'house', 'kick', 'drum'], { voices: 2, level: 0.72 }, (b) => {
    // A sine whose pitch drops from five times the note to the note: play it around C-2.
    const body = osc(b, { waveform: SINE, fmDepth: 4 })
    b.wire(env(b, 0.001, 0.06, 0, 0.01), body, 'fm')
    const punch = b.add('tanh', { drive: 2.5, level: 0.8 })
    b.wire(vca(b, body, env(b, 0.001, 0.35, 0, 0.05)), punch, 'in')
    const click = b.add('filter', { mode: HIGHPASS, cutoff: 3000, q: 0.7 })
    b.wire(b.add('noise'), click, 'in')
    toOutput(b, mix(b, punch, vca(b, click, env(b, 0.001, 0.008, 0, 0.005), 0.3)))
  }),
  patch('synth-snare', 'Synth Snare', 'Drums', ['techno', 'electro', 'snare', 'drum'], { voices: 2, level: 0.87 }, (b) => {
    const tone = vca(b, b.add('dxop', { freqMode: 1, fixedHz: 185 }), env(b, 0.001, 0.12, 0, 0.05), 0.8)
    const rattle = b.add('filter', { mode: HIGHPASS, cutoff: 1200, q: 0.7 })
    b.wire(b.add('noise'), rattle, 'in')
    toOutput(b, mix(b, tone, vca(b, rattle, env(b, 0.001, 0.18, 0, 0.08), 0.9)))
  }),
  patch('hi-hat', 'Hi-Hat', 'Drums', ['techno', 'house', 'hat', 'drum'], { voices: 2, level: 1.82 }, (b) => {
    const f = b.add('filter', { mode: HIGHPASS, cutoff: 7000, q: 1 })
    b.wire(b.add('noise'), f, 'in')
    const band = b.add('filter', { mode: BANDPASS, cutoff: 10000, q: 0.8 })
    b.wire(f, band, 'in')
    toOutput(b, vca(b, band, env(b, 0.001, 0.05, 0, 0.03)))
  }),
]
