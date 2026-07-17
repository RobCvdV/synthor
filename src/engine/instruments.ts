import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Instrument } from '../domain/types'
import { compileModular, makeAdsr, type StereoOut } from './modular'

/**
 * An instrument is a node factory: given the control signals a track drives
 * (frequency + gate), it returns a stereo audio pair. Mono instruments (osc)
 * duplicate the same signal to both channels; modular instruments can route
 * different signals to the output module's L/R inlets for true stereo.
 */
/** Sample metadata needed by the compile pipeline. */
export interface SampleMeta {
  hash: string
  channels: number
  /** Sample rate in Hz (e.g. 44100). */
  sampleRate: number
  /** Total frames per channel. */
  frames: number
}

export function renderInstrument(
  inst: Instrument,
  freq: NodeRepr_t | number,
  gate: NodeRepr_t | number,
  voiceKey: string,
  /** Sample metadata for sampleIndex → VFS key + channel count resolution. */
  sampleMeta: SampleMeta[] = [],
  /** Raw MIDI note (0-127) for drumkit slot mapping. */
  note: NodeRepr_t | number = 0,
  /** sampleId → VFS hash lookup for drumkit slot resolution. */
  sampleHashById: Record<string, string> = {},
  /** Base frequency in Hz for sample pitch tracking (preview only). */
  baseFreq: number = 0,
  /** Per-cell volume signal (0..1). Defaults to 1 (no attenuation). */
  volume: NodeRepr_t | number = 1,
): StereoOut {
  switch (inst.kind) {
    case 'osc': {
      void voiceKey; void note; void baseFreq
      const env = makeAdsr(0.005, 0.12, 0.7, 0.25, gate)
      const tone = el.blepsaw(freq)
      const out = el.mul(tone, env, inst.params.gain, volume)
      return { left: out, right: out }
    }
    case 'modular': {
      void note
      return compileModular(inst, freq, gate, voiceKey, sampleMeta, baseFreq, volume)
    }
    case 'drumkit': {
      void voiceKey; void freq
      const zero = el.const({ value: 0 })
      let mixL: NodeRepr_t = zero
      let mixR: NodeRepr_t = zero

      for (const slot of inst.slots) {
        const path = sampleHashById[slot.sampleId]
        if (!path) continue

        const [sampleNode] = el.mc.sample(
          { key: `${voiceKey}:${slot.id}`, path, channels: 1, playbackRate: Math.pow(2, slot.pitchOffset / 12) },
          gate,
        )
        // Pan: left = gain*(1-pan)/2, right = gain*(1+pan)/2
        const g = el.const({ value: slot.gain })
        const p = el.const({ value: slot.pan })
        const half = el.const({ value: 0.5 })
        const one = el.const({ value: 1 })
        mixL = el.add(mixL, el.mul(sampleNode, el.mul(g, el.mul(half, el.sub(one, p)))))
        mixR = el.add(mixR, el.mul(sampleNode, el.mul(g, el.mul(half, el.add(one, p)))))
      }

      const masterGain = el.const({ value: inst.params.gain })
      return { left: el.mul(mixL, masterGain, volume), right: el.mul(mixR, masterGain, volume) }
    }
  }
}
