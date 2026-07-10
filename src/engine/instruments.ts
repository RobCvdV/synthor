import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Instrument } from '../domain/types'

/**
 * An instrument is a node factory: given the control signals a track drives
 * (frequency + gate), it returns a mono audio node. This same shape scales up
 * to sample players, drumkits, and full modular patches later — the tracker
 * never needs to know what's inside.
 */
export function renderInstrument(
  inst: Instrument,
  freq: NodeRepr_t | number,
  gate: NodeRepr_t | number,
  voiceKey: string,
): NodeRepr_t {
  switch (inst.kind) {
    case 'osc': {
      // Band-limited saw through a simple ADSR. Keys keep node identity stable
      // across re-renders so Elementary reconciles instead of rebuilding.
      // Voices reconcile by structural position (stable track order); the
      // keyed seq2 nodes carry the identity that actually needs pinning.
      void voiceKey
      const env = el.adsr(0.005, 0.12, 0.7, 0.25, gate)
      const tone = el.blepsaw(freq)
      return el.mul(tone, env, inst.params.gain)
    }
  }
}
