import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Instrument } from '../domain/types'
import { compileModular, type StereoOut } from './modular'

/**
 * An instrument is a node factory: given the control signals a track drives
 * (frequency + gate), it returns a stereo audio pair. Mono instruments (osc)
 * duplicate the same signal to both channels; modular instruments can route
 * different signals to the output module's L/R inlets for true stereo.
 */
export function renderInstrument(
  inst: Instrument,
  freq: NodeRepr_t | number,
  gate: NodeRepr_t | number,
  voiceKey: string,
): StereoOut {
  switch (inst.kind) {
    case 'osc': {
      void voiceKey
      const env = el.adsr(0.005, 0.12, 0.7, 0.25, gate)
      const tone = el.blepsaw(freq)
      const out = el.mul(tone, env, inst.params.gain)
      return { left: out, right: out }
    }
    case 'modular':
      return compileModular(inst, freq, gate, voiceKey)
  }
}
