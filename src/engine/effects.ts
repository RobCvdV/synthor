/**
 * Effect engine — processes per-row effect commands and produces Elementary
 * modulation signals. Works with the sequences built by `buildSequences` in
 * `sequences.ts`.
 *
 * Effects are applied per-row (not per-tick — a tick system may come later).
 * Each effect modifies the frequency, volume, or stereo balance of a voice.
 */

import { el, type NodeRepr_t } from '@elemaudio/core'
import { Eff, effectOperand, effectType, operandXY } from '../domain/effects'

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
  /** Frequency multiplier (1.0 = no change). Arpeggio and portamento modify this. */
  freqMul: number[]
  /** Volume modifier (1.0 = no change). Volume slide and tremolo modify this. */
  volMod: number[]
  /** Pan value per row, 0..1 (0=left, 0.5=center, 1=right). Null means no panning effect. */
  pan: (number | null)[]
  /** Pattern break target row, null = no break. The transport reads this. */
  breakRow: (number | null)[]
}

/**
 * Build per-row effect modulation signals from the effect + effectValue
 * sequences produced by `buildSequences`.
 */
export function buildEffectSignals(
  effectSeq: (number | null)[],
  length: number,
): EffectSignals {
  const freqMul: number[] = new Array(length).fill(1)
  const volMod: number[] = new Array(length).fill(1)
  const pan: (number | null)[] = new Array(length).fill(null)
  const breakRow: (number | null)[] = new Array(length).fill(null)

  // State accumulators for portamento and volume slide.
  let portaOffset = 0 // in semitones
  let volSlideAccum = 0 // added to volume (clamped to [0, 1] after)

  for (let row = 0; row < length; row++) {
    const packed = effectSeq[row]
    if (packed === null) continue

    const type = effectType(packed)
    const op = effectOperand(packed)
    const { x, y } = operandXY(op)

    switch (type) {
      case Eff.Arpeggio: {
        // Arpeggio: cycle base, base+x, base+y on consecutive rows.
        // Cycle position is based on the row within the pattern.
        const cyclePos = row % 3
        const semi = cyclePos === 0 ? 0 : cyclePos === 1 ? x : y
        freqMul[row] = Math.pow(2, semi / 12)
        break
      }

      case Eff.PortaUp:
        // Portamento up: slide pitch up by xx units each row.
        // xx is a raw speed value; scale to semitones (1 unit = 1/16 semitone).
        portaOffset += op * (1 / 16)
        freqMul[row] = Math.pow(2, portaOffset / 12)
        break

      case Eff.PortaDown:
        // Portamento down: slide pitch down by xx units each row.
        portaOffset -= op * (1 / 16)
        freqMul[row] = Math.pow(2, portaOffset / 12)
        break

      case Eff.Vibrato: {
        // Vibrato: modulate pitch with depth y (in 1/16 semitones) at speed x.
        // We encode the depth in freqMul as a sine LFO — but since this is
        // per-row, we store the LFO value pre-computed. For a proper vibrato
        // the LFO runs per-sample in Elementary; here we approximate with
        // a per-row sine phase.
        const phase = (row * x) / length * Math.PI * 2
        const depth = (y * (1 / 16)) / 12 // y/16 semitones → multiplier
        freqMul[row] = Math.pow(2, Math.sin(phase) * depth)
        break
      }

      case Eff.Tremolo: {
        // Tremolo: modulate volume with depth y at speed x.
        const phase = (row * x) / length * Math.PI * 2
        const depth = y / 15 // 0..1
        volMod[row] = 1 - depth * (1 - Math.abs(Math.sin(phase)))
        break
      }

      case Eff.SetPanning:
        // Set panning: xx = 00 (left) .. 80 (center) .. FF (right).
        pan[row] = op / 255
        break

      case Eff.VolumeSlide:
        // Volume slide: x = slide up speed, y = slide down speed.
        // Each unit is 1/64 of the volume range.
        volSlideAccum += (x - y) * (1 / 64)
        volSlideAccum = Math.max(-1, Math.min(1, volSlideAccum))
        volMod[row] = Math.max(0, Math.min(1, 1 + volSlideAccum))
        break

      case Eff.PatternBreak:
        // Pattern break: jump to row xx of the next pattern.
        // The transport reads this; we just store the target.
        breakRow[row] = op
        break

      default:
        // Unknown effect — ignore silently (forward compat).
        break
    }
  }

  return { freqMul, volMod, pan, breakRow }
}

/**
 * Apply the effect modulation signals (already compiled into seq2 arrays) to
 * the instrument's frequency and volume signals. Returns modified signals
 * plus stereo pan gains.
 *
 * `freqMulSeq`, `volModSeq`, and `panSeq` should be `el.seq2` nodes driven by
 * the same clock as the instrument.
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

/**
 * Detect if any row in a pattern has a break effect. Returns the first break
 * row found, or null. The transport uses this to schedule a pattern jump.
 */
export function findPatternBreak(
  breakRowSeq: (number | null)[],
  currentRow: number,
): number | null {
  // Look forward from currentRow to find the next break.
  for (let i = currentRow; i < breakRowSeq.length; i++) {
    if (breakRowSeq[i] !== null) return breakRowSeq[i]
  }
  return null
}
