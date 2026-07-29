/**
 * Effect engine — processes per-row effect lane values and produces Elementary
 * modulation signals. Works with the sequences built by `buildSequences` in
 * `sequences.ts`.
 *
 * Built-in lane types:
 *   vibrato / tremolo — rate+depth arrays feed audio-rate `el.cycle` LFOs in
 *     compile.ts for smooth continuous modulation.
 *   portaUp / portaDown — per-row pitch multiplier.
 *   volumeSlide — per-row volume delta.
 *   panning — per-row stereo position (0=left, 0.5=center, 1=right).
 *
 * Named instrument inlets pass through as raw per-row seq2 signals.
 */

import type { EffectLaneDef, EffectSettings, Id } from '../domain/types'
import { DEFAULT_EFFECT_SETTINGS } from '../domain/types'
import { isBuiltinLaneType } from '../domain/effects'

/** Stereo pan gains for a given pan value (0=left, 0.5=center, 1=right). */
export function panGains(pan: number): { left: number; right: number } {
  const angle = pan * (Math.PI / 2)
  return { left: Math.cos(angle), right: Math.sin(angle) }
}

export interface EffectSignals {
  /** Per-row frequency multiplier from portamento (1.0 = no change). */
  freqMul: number[]
  /** Per-row volume modifier from volumeSlide (1.0 = no change). */
  volMod: number[]
  /** Per-row pan position, 0..1 (0=left, 0.5=center, 1=right). */
  pan: number[]
  /** Per-row vibrato LFO rate, 0..1 → 0.5–50 Hz. */
  vibratoRate: number[]
  /** Per-row vibrato LFO depth, 0..1 → 0–0.5 semitones. */
  vibratoDepth: number[]
  /** Per-row tremolo LFO rate, 0..1 → 0.5–50 Hz. */
  tremoloRate: number[]
  /** Per-row tremolo LFO depth, 0..1 → 0–1 amplitude modulation. */
  tremoloDepth: number[]
}

export function emptyEffectSignals(length: number): EffectSignals {
  return {
    freqMul: new Array(length).fill(1),
    volMod: new Array(length).fill(1),
    pan: new Array(length).fill(0.5),
    vibratoRate: new Array(length).fill(0),
    vibratoDepth: new Array(length).fill(0),
    tremoloRate: new Array(length).fill(0),
    tremoloDepth: new Array(length).fill(0),
  }
}

/**
 * Build per-row effect modulation signals from per-lane sequences.
 *
 * Vibrato/tremolo rate and depth are extracted as raw 0..1 arrays — the actual
 * audio-rate LFO (`el.cycle`) is built in compile.ts so modulation is continuous
 * rather than stair-stepped per row.
 */
export function buildEffectSignals(
  effectLaneSeqs: Record<Id, number[]>,
  laneDefs: EffectLaneDef[],
  length: number,
  settings?: EffectSettings,
): EffectSignals {
  const sig = emptyEffectSignals(length)

  for (const lane of laneDefs) {
    const seq = effectLaneSeqs[lane.id]
    if (!seq) continue
    if (!isBuiltinLaneType(lane.type)) continue

    for (let row = 0; row < length; row++) {
      const val = seq[row]

      switch (lane.type) {
        case 'vibratoRate':
          sig.vibratoRate[row] = Math.max(sig.vibratoRate[row], val)
          break
        case 'vibratoDepth':
          sig.vibratoDepth[row] = Math.max(sig.vibratoDepth[row], val)
          break
        case 'tremoloRate':
          sig.tremoloRate[row] = Math.max(sig.tremoloRate[row], val)
          break
        case 'tremoloDepth':
          sig.tremoloDepth[row] = Math.max(sig.tremoloDepth[row], val)
          break
        case 'portamento': {
          // 0.5 = center (no change), 0 = full down, 1 = full up.
          // Unset rows default to 0.5 via the sequence builder, so no null check needed.
          const max = settings?.portamento ?? DEFAULT_EFFECT_SETTINGS.portamento
          const semitones = (val - 0.5) * 2 * max
          sig.freqMul[row] *= Math.pow(2, semitones / 12)
          break
        }
        case 'volumeSlide':
          // Absolute volume target: 0..1 directly sets the per-row volume modifier.
          // Unset rows default to 0 via the sequence builder.
          sig.volMod[row] = val
          break
        case 'panning':
          sig.pan[row] = val
          break
      }
    }
  }

  return sig
}
