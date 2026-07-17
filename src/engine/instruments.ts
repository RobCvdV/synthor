import { createNode, el, resolve, unpack, type NodeRepr_t } from '@elemaudio/core'
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
      // Drumkit rendering is handled at the compile level via renderDrumKitSlot,
      // so per-slot sequencer signals (gate + freq) can be used.
      void voiceKey; void freq; void note; void baseFreq; void sampleMeta; void sampleHashById; void volume; void gate
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
        const gain = el.const({ value: 1 })

        // Pitch-tracked one-shot sample playback via table + syncphasor.
        //
        // Drum hits always play to completion regardless of how long the key
        // is held. We derive a one-shot gate from the trigger whose length
        // matches the sample duration, so the envelope gates the output to
        // silence after one pass through the sample.
        //
        // The per-note frequency controls playback rate relative to the
        // slot's base note (higher note = faster playback = higher pitch).
        const centerFreq = midiToFreq(slot.note)
        const sampleDur = meta.frames / meta.sampleRate
        const rateFactor = meta.sampleRate / (meta.frames * centerFreq)
        const rate = el.mul(slotFreq, el.const({ key: `${key}:rf`, value: rateFactor }))

        // Rising-edge detector: trigger = max(gate - delay1(gate), 0).
        // For pattern gates (seq2) this fires on every row trigger;
        // for preview gates (constant 1) this fires once at note-on.
        const delayed = el.delay({ size: 2 }, 1, 0, slotGate)
        const trigger = el.max(el.sub(slotGate, delayed), 0)

        // One-shot timer: a ramp 0→1 over exactly the sample duration,
        // reset by the trigger. The resulting gate is high for sampleDur
        // seconds after each trigger, then low — making drum hits one-shot.
        const osPhase = el.syncphasor(
          el.const({ key: `${key}:osRate`, value: 1 / sampleDur }),
          trigger,
        )
        const oneShotGate = el.sub(1, el.geq(osPhase, el.const({ value: 0.999 })))

        const phase = el.syncphasor(rate, trigger)
        const time = el.mul(phase, el.const({ key: `${key}:dur`, value: sampleDur }))
        const tbl = createNode('table', {
          key: `${key}:tbl`,
          path: hash,
          channels: meta.channels,
        }, [resolve(time)])
        const ch = unpack(tbl as NodeRepr_t, meta.channels)
        // Fast one-shot envelope: attack immediately, sustain at 1 for the
        // sample duration (controlled by oneShotGate), then quick release.
        const env = makeAdsr(0.001, 0.02, 1, 0.02, oneShotGate)

        rawL = el.mul(ch[0], gain, env)
        rawR = meta.channels === 2 ? el.mul(ch[1], gain, env) : rawL
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
        1,
      )
      rawL = voice.left
      rawR = voice.right
    }
  }

  // Apply per-slot gain and constant-power pan.
  const g = el.const({ value: slot.gain })
  const p = el.const({ value: slot.pan })
  const half = el.const({ value: 0.5 })
  const one = el.const({ value: 1 })
  return {
    left: el.mul(rawL, g, el.mul(half, el.sub(one, p))),
    right: el.mul(rawR, g, el.mul(half, el.add(one, p))),
  }
}
