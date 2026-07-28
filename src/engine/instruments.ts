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
  /** Base frequency in Hz for sample pitch tracking (preview only). */
  baseFreq: number = 0,
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
      void voiceKey; void note; void baseFreq; void inletSignals; void midiCcValues; void ccBindings
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
      return compileModular(inst, freq, gate, voiceKey, sampleMeta, baseFreq, volume, inletSignals, midiCcValues, paramRefs, ccBindings)
    }
    case 'drumkit': {
      // Drumkit rendering is handled at the compile level via renderDrumKitSlot,
      // so per-slot sequencer signals (gate + freq) can be used.
      void voiceKey; void freq; void note; void baseFreq; void sampleMeta; void sampleHashById; void volume; void gate; void inletSignals; void ccBindings
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
  /** Drumkit instrument id — when provided, slot gain/pan use createRef. */
  kitInstId?: string,
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

        // One-shot sample playback via Elementary's built-in el.sample.
        // This is the same node the modular synth uses — it handles stereo
        // correctly and plays once on each gate rising edge.
        //
        // playbackRate is relative to original speed: 1.0 = original pitch,
        // 2.0 = one octave up. Computed from slot.note + pitchOffset, NOT
        // the triggering MIDI note — drum hits are not pitch-tracked.
        const centerFreq = midiToFreq(slot.note)
        const playbackRate = midiToFreq(slot.note + slot.pitchOffset) / centerFreq
        const ch = el.mc.sample(
          {
            key: `${key}:sample`,
            path: hash,
            channels: meta.channels,
            playbackRate,
          },
          slotGate,
        )
        const gain = el.const({ value: 1 })
        rawL = el.mul(ch[0], gain)
        rawR = el.mul(ch[meta.channels === 2 ? 1 : 0], gain)
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
        midiToFreq(slot.note),
        1, // volume
        {}, // inletSignals — drumkit slots don't use effect lanes
        midiCcValues,
        paramRefs,
        ccBindings,
      )
      rawL = voice.left
      rawR = voice.right
    }
  }

  // Apply per-slot gain and constant-power pan.
  // Use createRef when available so slider changes don't need a recompile.
  const slotKey = (name: string) => kitInstId ? `${kitInstId}:slot:${slot.id}:${name}` : ''
  const g = paramRefs && kitInstId
    ? paramRefs.getOrCreate(slotKey('gain'), slot.gain)
    : el.const({ value: slot.gain })
  const panL = paramRefs && kitInstId
    ? paramRefs.getOrCreate(slotKey('panL'), 0.5 * (1 - slot.pan))
    : el.const({ value: 0.5 * (1 - slot.pan) })
  const panR = paramRefs && kitInstId
    ? paramRefs.getOrCreate(slotKey('panR'), 0.5 * (1 + slot.pan))
    : el.const({ value: 0.5 * (1 + slot.pan) })
  return {
    left: el.mul(rawL, g, panL),
    right: el.mul(rawR, g, panR),
  }
}
