/**
 * Effect engine — processes per-row effect lane values and produces Elementary
 * modulation signals. Works with the sequences built by `buildSequences` in
 * `sequences.ts`.
 *
 * Built-in lane types (vibrato, tremolo, portamento, volumeSlide, panning)
 * produce freqMul, volMod, and pan modulation arrays. Named instrument inlets
 * pass through as raw per-row signals to the modular synth graph.
 */

import { el, type NodeRepr_t } from '@elemaudio/core'
import type { EffectLaneDef, Id } from '../domain/types'
import { isBuiltinLaneType } from '../domain/effects'

/** Stereo pan gains for a given pan value (0=left, 0.5=center, 1=right). */
export function panGains(pan: number): { left: number; right: number } {
  // Constant-power panning
  const angle = pan * (Math.PI / 2)
  return { left: Math.cos(angle), right: Math.sin(angle) }
}

/**
 * Built effect sequences — parallel arrays (one entry per row) that feed into
 * `el.seq2` to modulate the instrument voice.
 */
export interface EffectSignals {
  /** Frequency multiplier (1.0 = no change). */
  freqMul: number[]
  /** Volume modifier (1.0 = no change). */
  volMod: number[]
  /** Pan value per row, 0..1 (0=left, 0.5=center, 1=right). */
  pan: number[]
}

/**
 * Build per-row effect modulation signals from per-lane sequences.
 *
 * Built-in lane types are processed into freqMul/volMod/pan. Named instrument
 * inlets are ignored here — they pass through as raw seq2 signals to the
 * modular graph.
 */
export function buildEffectSignals(
  effectLaneSeqs: Record<Id, number[]>,
  laneDefs: EffectLaneDef[],
  length: number,
): EffectSignals {
  const freqMul: number[] = new Array(length).fill(1)
  const volMod: number[] = new Array(length).fill(1)
  const pan: number[] = new Array(length).fill(0.5)

  // Collect vibrato rate/depth and tremolo rate/depth pairs for combined processing.
  // Multiple lanes composing on the same target multiply together.
  for (const lane of laneDefs) {
    const seq = effectLaneSeqs[lane.id]
    if (!seq) continue
    if (!isBuiltinLaneType(lane.type)) continue // named inlets pass through unchanged

    for (let row = 0; row < length; row++) {
      const val = seq[row]

      switch (lane.type) {
        case 'vibratoDepth': {
          // Look up the corresponding vibratoRate value for this row.
          const rateLane = laneDefs.find((l) => l.type === 'vibratoRate')
          const rateSeq = rateLane ? effectLaneSeqs[rateLane.id] : null
          const rate = rateSeq ? rateSeq[row] : 0.5 // default mid-rate if no rate lane
          const hz = 0.5 + rate * 49.5 // 0..1 → 0.5–50 Hz
          const phase = (row * hz * length / (length * 8)) * Math.PI * 2 // crude per-row phase
          const depth = val * 0.5 // max ~0.5 semitone
          freqMul[row] *= Math.pow(2, Math.sin(phase) * depth / 12)
          break
        }
        case 'vibratoRate':
          // Rate alone doesn't modulate — it's only used when paired with vibratoDepth.
          break
        case 'tremoloDepth': {
          const rateLane = laneDefs.find((l) => l.type === 'tremoloRate')
          const rateSeq = rateLane ? effectLaneSeqs[rateLane.id] : null
          const rate = rateSeq ? rateSeq[row] : 0.5
          const hz = 0.5 + rate * 49.5
          const phase = (row * hz * length / (length * 8)) * Math.PI * 2
          const depth = val
          volMod[row] *= Math.max(0.05, 1 - depth * (1 - Math.abs(Math.sin(phase))))
          break
        }
        case 'tremoloRate':
          // Rate alone doesn't modulate — it's only used when paired with tremoloDepth.
          break
        case 'portaUp': {
          // Absolute per-step pitch bend up. 0-1 → 0-4 semitones.
          const semitones = val * 4
          freqMul[row] *= Math.pow(2, semitones / 12)
          break
        }
        case 'portaDown': {
          const semitones = val * 4
          freqMul[row] *= Math.pow(2, -semitones / 12)
          break
        }
        case 'volumeSlide': {
          // Absolute per-step volume delta. 0 = -0.5, 0.5 = no change, 1 = +0.5.
          const delta = (val - 0.5) * 1.0
          volMod[row] *= Math.max(0, Math.min(1, 1 + delta))
          break
        }
        case 'panning': {
          // Directly set stereo position. 0=left, 0.5=center, 1=right.
          pan[row] = val
          break
        }
      }
    }
  }

  return { freqMul, volMod, pan }
}

/**
 * Apply the effect modulation signals (already compiled into seq2 arrays) to
 * the instrument's frequency and volume signals. Returns modified signals
 * plus stereo pan gains.
 */
export function applyEffectModulation(
  freq: NodeRepr_t,
  vol: NodeRepr_t,
  freqMulSeq: NodeRepr_t,
  volModSeq: NodeRepr_t,
): { freq: NodeRepr_t; vol: NodeRepr_t } {
  return {
    freq: el.mul(freq, freqMulSeq),
    vol: el.mul(vol, volModSeq),
  }
}
