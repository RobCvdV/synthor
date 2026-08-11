import { el, type NodeRepr_t } from '@elemaudio/core'
import type { DrumKitSlot, Id, Instrument } from '../domain/types'
import { midiToFreq } from '../domain/notes'
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
  /** Per-cell volume signal (0..1). Defaults to 1 (no attenuation). */
  volume: NodeRepr_t | number = 1,
  /** Per-effect-lane seq2 signals for named instrument inlets, keyed by inlet name. */
  inletSignals: Record<string, NodeRepr_t> = {},
  /** MIDI CC values (0-127 → raw 0-127).  Used by `midicc` source modules. */
  midiCcValues?: Record<number, number>,
  /** Param ref registry for zero-recompile value updates. */
  paramRefs?: import('../audio/paramRefs').ParamRefRegistry,
  /** CC binding table — populated during compile so MIDI CC changes update refs. */
  ccBindings?: import('../audio/ccBindings').CcBindings,
): StereoOut {
  switch (inst.kind) {
    case 'osc': {
      void voiceKey; void note; void inletSignals; void midiCcValues; void ccBindings
      const env = makeAdsr(0.005, 0.12, 0.7, 0.25, gate)
      const tone = el.blepsaw(freq)
      // Use createRef when available so slider changes take effect without recompile.
      const gain = paramRefs
        ? paramRefs.getOrCreate(`${inst.id}:gain`, inst.params.gain)
        : el.const({ value: inst.params.gain })
      const out = el.mul(tone, env, gain, volume)
      return { left: out, right: out }
    }
    case 'modular': {
      void note
      return compileModular(inst, freq, gate, voiceKey, sampleMeta, volume, inletSignals, midiCcValues, paramRefs, ccBindings)
    }
    case 'drumkit': {
      // Drumkit rendering is handled at the compile level via renderDrumKitSlot,
      // so per-slot sequencer signals (gate + freq) can be used.
      void voiceKey; void freq; void note; void sampleMeta; void sampleHashById; void volume; void gate; void inletSignals; void ccBindings
      return { left: el.const({ value: 0 }), right: el.const({ value: 0 }) }
    }
  }
}

/**
 * Render a single drumkit slot as a stereo pair.
 *
 * For sample-based slots the sample is played back with pitch tracking via a
 * table + phasor, so the per-row frequency signal from the slot sequencer
 * controls pitch. For instrument-based slots the assigned instrument is
 * rendered with the slot's gate and frequency signals.
 */
export function renderDrumKitSlot(
  slot: DrumKitSlot,
  instruments: Record<Id, Instrument>,
  slotGate: NodeRepr_t | number,
  slotFreq: NodeRepr_t | number,
  voiceKey: string,
  sampleMeta: SampleMeta[],
  sampleHashById: Record<Id, string>,
  midiCcValues?: Record<number, number>,
  paramRefs?: import('../audio/paramRefs').ParamRefRegistry,
  ccBindings?: import('../audio/ccBindings').CcBindings,
  /** Named inlet signals from effect lanes, propagated to sub-instruments. */
  inletSignals: Record<string, NodeRepr_t> = {},
  /** Drumkit instrument id — when provided, slot volume/pan use createRef. */
  kitInstId?: string,
  /** Instrument-level pan (-1..+1). Combined with slot pan via addition. */
  instPan: NodeRepr_t | number = 0,
): StereoOut {
  const zero = el.const({ value: 0 })
  let rawL: NodeRepr_t = zero
  let rawR: NodeRepr_t = zero

  if (slot.sampleId) {
    const hash = sampleHashById[slot.sampleId]
    if (!hash) {
      console.warn(`Drumkit slot "${slot.id}" references unknown sample "${slot.sampleId}" — no hash found`)
    }
    if (hash) {
      const meta = sampleMeta.find((s) => s.hash === hash)
      if (!meta) {
        console.warn(`Sample hash "${hash.slice(0, 8)}…" (slot "${slot.id}") not loaded in VFS — sample may be missing from OPFS`)
      }
      if (meta) {
        const key = `${voiceKey}:slot:${slot.id}:${hash}`

        // el.mc.sample — v4 native API, reliable gate + proper multi-channel.
        // playbackRate sets the base pitch; per-note offset within the slot's
        // range is not yet supported with mc.sample (no signal-rate rate).
        const baseFreq = 261.6255653005986 // midiToFreq(60)
        const playbackRate = midiToFreq(slot.baseNote) / baseFreq
        const ch = el.mc.sample(
          { key: `${key}:sample`, path: hash, channels: meta.channels, playbackRate },
          slotGate,
        )
        rawL = ch[0]
        rawR = ch[meta.channels >= 2 ? 1 : 0]
      }
    }
  } else if (slot.instrumentId) {
    const inst = instruments[slot.instrumentId]
    if (inst) {
      const voice = renderInstrument(
        inst,
        slotFreq,
        slotGate,
        `${voiceKey}:${slot.id}`,
        sampleMeta,
        0,
        sampleHashById,
        1, // volume — slot volume multiplies in end stage
        inletSignals,
        midiCcValues,
        paramRefs,
        ccBindings,
      )
      rawL = voice.left
      rawR = voice.right
    }
  }

  // Apply per-slot volume and combined pan (slot + instrument).
  const slotKey = (name: string) => kitInstId ? `${kitInstId}:slot:${slot.id}:${name}` : ''
  const volRef = paramRefs && kitInstId
    ? paramRefs.getOrCreate(slotKey('volume'), slot.volume)
    : el.const({ value: slot.volume })
  const slotPanRef = paramRefs && kitInstId
    ? paramRefs.getOrCreate(slotKey('pan'), slot.pan)
    : el.const({ value: slot.pan })
  // Combine slot pan + instrument pan, clamped to [-1, 1].
  const effPan = el.max(el.const({ value: -1 }),
    el.min(el.const({ value: 1 }),
      el.add(slotPanRef, instPan)))
  // Constant-power pan without √2 boost (channel-level applyPan provides it).
  const angle = el.add(el.mul(effPan, Math.PI / 4), Math.PI / 4)
  const panL = el.cos(angle)
  const panR = el.sin(angle)
  return {
    left: el.mul(rawL, volRef, panL),
    right: el.mul(rawR, volRef, panR),
  }
}
