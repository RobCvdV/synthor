import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc, Id, SampleEntity } from '../domain/types'
import { isBuiltinLaneType } from '../domain/effects'
import { midiToFreq } from '../domain/notes'
import { buildDrumKitSlotSequences, buildSequences } from './sequences'
import { renderDrumKitSlot, renderInstrument } from './instruments'
import { applyEffectModulation, buildEffectSignals } from './effects'
import type { StereoOut } from './modular'

/** Build the sorted sample metadata list for sampleIndex → VFS key + channels resolution.
 *  Only includes samples whose data is actually loaded in Elementary's VFS. */
function buildSampleMeta(
  samples: Record<Id, SampleEntity>,
  vfsLoaded?: Set<string>,
): { hash: string; channels: number; sampleRate: number; frames: number }[] {
  return Object.values(samples)
    .filter((s) => !vfsLoaded || vfsLoaded.has(s.hash))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ hash: s.hash, channels: s.channels, sampleRate: s.sampleRate, frames: s.frames }))
}

/** Build a sampleId → hash lookup for drumkit slot resolution. */
function buildSampleHashById(samples: Record<Id, SampleEntity>): Record<Id, string> {
  const map: Record<Id, string> = {}
  for (const [id, s] of Object.entries(samples)) {
    map[id] = s.hash
  }
  return map
}

/** A live-played note for the instrument-editor keyboard preview. */
export interface PreviewVoice {
  note: number
  /** 1 while the key is held, 0 during the release tail. */
  gate: 0 | 1
  /** MIDI velocity 0–127 (defaults to 127 from PC keyboard). */
  velocity: number
}

/** Everything the compiler needs from the transport, as plain data. */
export interface RenderContext {
  /** Rows advanced per second (from tempo). */
  rowHz: number
  /** 1 while playing, 0 when stopped (silences output without tearing down). */
  playing: number
  /** Pattern row at which playback started (0 = top, or cursor row). */
  startRow: number
  /** Incremented on each play start so the audio graph gets fresh clock/seq2 nodes. */
  playEpoch: number
  /** Muted track ids. Muted voices are gained to 0 but kept in the graph so
   *  their sequencer phase is preserved across mute/unmute. */
  mutedTracks?: Record<string, boolean>
  /** Live keyboard preview: sounds regardless of transport play state so you
   *  can audition an instrument while it's stopped. */
  preview?: { instrumentId: Id; voices: PreviewVoice[] }
  /** Hashes of samples successfully loaded into Elementary's VFS.
   *  Sample entities whose hashes aren't in this set are skipped. */
  vfsLoadedHashes?: Set<string>
  /** MIDI CC values, keyed by CC number (0-127).  Used by `midicc` source modules. */
  midiCcValues?: Record<number, number>
  /** Param ref registry for zero-recompile value updates. */
  paramRefs?: import('../audio/paramRefs').ParamRefRegistry
  /** Voice pool for the currently previewed instrument (fixed polyphony). */
  voicePool?: import('./voicePool').VoicePool
  /** CC# → ref-key mapping, populated during compile so MIDI CC changes
   *  update the right refs without a recompile. */
  ccBindings?: import('../audio/ccBindings').CcBindings
}

/**
 * Live-preview voices for the instrument editor. Each held/releasing note is a
 * voice keyed uniquely (per note) so polyphony reconciles cleanly and doesn't
 * collide with the shared instrument's pattern voices. Returns null when there
 * is nothing to preview, so the pattern-only graph is left untouched.
 */
function compilePreview(
  doc: Doc,
  preview: RenderContext['preview'],
  vfsLoaded?: Set<string>,
  midiCcValues?: Record<number, number>,
  paramRefs?: RenderContext['paramRefs'],
  voicePool?: RenderContext['voicePool'],
  ccBindings?: RenderContext['ccBindings'],
): StereoOut | null {
  if (!preview) return null
  const inst = doc.entities.instruments[preview.instrumentId]
  if (!inst) return null

  const sampleMeta = buildSampleMeta(doc.entities.samples, vfsLoaded)
  const sampleHashById = buildSampleHashById(doc.entities.samples)
  const zero = el.const({ value: 0 })

  // Fallback: no VoicePool (e.g. tests) — use dynamic voices as before.
  if (!voicePool) {
    if (preview.voices.length === 0) return null
    const voices = preview.voices.map((v) => {
      const voiceKey = `preview:${inst.id}:${v.note}`
      const freq = el.const({ key: `${voiceKey}:freq`, value: midiToFreq(v.note) })
      const gate = el.const({ key: `${voiceKey}:gate`, value: v.gate })
      const velGain = v.velocity / 127
      return renderInstrument(inst, freq, gate, voiceKey, sampleMeta, 0, sampleHashById, midiToFreq(v.note), velGain, {}, midiCcValues, paramRefs, ccBindings)
    })
    return {
      left: el.mul(voices.reduce((a, v) => el.add(a, v.left), zero), 0.3),
      right: el.mul(voices.reduce((a, v) => el.add(a, v.right), zero), 0.3),
    }
  }

  // Fixed voice slots: always build all slots with createRef nodes.
  // VoicePool updates ref values directly — no recompile for note events.
  const slotCount = voicePool.size
  if (inst.kind === 'drumkit') {
    // Drumkit preview: each drumkit slot gets its own signal chain with
    // dedicated gate/freq/vel refs, so MIDI notes route to the correct
    // sound (kick → kick slot, snare → snare slot, etc.).
    //
    // Two sub-voices per slot handle overlapping retriggers (e.g. hi-hat).
    const kit = inst // narrow type to DrumKitInstrument for clarity
    const subVoicesPerSlot = 2
    const slotVoices: StereoOut[] = []
    for (let si = 0; si < kit.slots.length; si++) {
      const slot = kit.slots[si]
      for (let sv = 0; sv < subVoicesPerSlot; sv++) {
        const voiceKey = `${inst.id}:ds:${si}:v${sv}`
        const freq = paramRefs
          ? paramRefs.getOrCreate(`${voiceKey}:freq`, 0)
          : el.const({ key: `${voiceKey}:freq`, value: 0 })
        const gate = paramRefs
          ? paramRefs.getOrCreate(`${voiceKey}:gate`, 0)
          : el.const({ key: `${voiceKey}:gate`, value: 0 })
        const velRef = paramRefs
          ? paramRefs.getOrCreate(`${voiceKey}:vel`, 1)
          : el.const({ key: `${voiceKey}:vel`, value: 1 })
        const voice = renderDrumKitSlot(
          slot, doc.entities.instruments, gate, freq, voiceKey,
          sampleMeta, sampleHashById, midiCcValues, paramRefs, ccBindings, inst.id,
        )
        slotVoices.push({ left: el.mul(voice.left, velRef), right: el.mul(voice.right, velRef) })
      }
    }
    const masterGain = paramRefs
      ? paramRefs.getOrCreate(`${inst.id}:masterGain`, inst.params.gain)
      : el.const({ value: inst.params.gain })
    return {
      left: el.mul(slotVoices.reduce((a, v) => el.add(a, v.left), zero), 0.3, masterGain),
      right: el.mul(slotVoices.reduce((a, v) => el.add(a, v.right), zero), 0.3, masterGain),
    }
  }

  // Osc / modular: one signal chain per voice slot, all slots always in the
  // graph.  Gate/freq/vel use createRef — VoicePool updates them directly.
  const slotVoices: StereoOut[] = []
  for (let i = 0; i < slotCount; i++) {
    const voiceKey = `${inst.id}:v:${i}`
    const freq = paramRefs
      ? paramRefs.getOrCreate(`${voiceKey}:freq`, 0)
      : el.const({ key: `${voiceKey}:freq`, value: 0 })
    const gate = paramRefs
      ? paramRefs.getOrCreate(`${voiceKey}:gate`, 0)
      : el.const({ key: `${voiceKey}:gate`, value: 0 })
    const velRef = paramRefs
      ? paramRefs.getOrCreate(`${voiceKey}:vel`, 1)
      : el.const({ key: `${voiceKey}:vel`, value: 1 })
    slotVoices.push(renderInstrument(inst, freq, gate, voiceKey, sampleMeta, 0, sampleHashById, 0, velRef, {}, midiCcValues, paramRefs, ccBindings))
  }
  return {
    left: el.mul(slotVoices.reduce((a, v) => el.add(a, v.left), zero), 0.3),
    right: el.mul(slotVoices.reduce((a, v) => el.add(a, v.right), zero), 0.3),
  }
}

/**
 * Rotate an array so that index `offset` becomes index 0.
 * newSeq[i] = oldSeq[(i + offset) % len]
 */
function rotateSeq<T>(seq: T[], offset: number): T[] {
  if (offset === 0 || seq.length === 0) return seq
  const len = seq.length
  const off = ((offset % len) + len) % len
  return seq.slice(off).concat(seq.slice(0, off))
}

/**
 * Compile the full document into a stereo pair. No React, no Zustand, no
 * AudioContext — pure, unit-testable, and reusable for offline bounce.
 */
export function compileGraph(doc: Doc, ctx: RenderContext): StereoOut {
  // Re-populated during graph build; clearing first prevents stale registrations.
  ctx.ccBindings?.clear()
  const preview = compilePreview(doc, ctx.preview, ctx.vfsLoadedHashes, ctx.midiCcValues, ctx.paramRefs, ctx.voicePool, ctx.ccBindings)
  const silence: StereoOut = {
    left: el.const({ value: 0 }),
    right: el.const({ value: 0 }),
  }

  const pattern = doc.entities.patterns[doc.patternId]
  if (!pattern || pattern.trackIds.length === 0) {
    return preview ?? silence
  }

  // The clock is gated by the playing signal so the sequencer only advances
  // while the transport is running. This ensures the sequencer pauses in place
  // when stopped and resumes from the same position when started again.
  // The seq2 keys include playEpoch, so on play-start we get fresh sequencers;
  // on doc edits while playing the keys match and Elementary preserves position.
  //
  // We force a fresh el.train node on each play start by adding a zero-valued
  // const whose key includes playEpoch. This gives the rate input a unique hash
  // per epoch, which propagates to the train node — guaranteeing phase 0 at
  // render time and eliminating the per-pause/resume clock-phase drift.
  const epochZero = el.const({ key: `train:epoch:${ctx.playEpoch}`, value: 0 })
  const clockRate = el.add(el.const({ value: ctx.rowHz }), epochZero)
  const rawClock = el.train(clockRate)
  const clock = el.mul(rawClock, ctx.playing)

  const loopHz = ctx.rowHz / pattern.length
  const loopEpochZero = el.const({ key: `reset:epoch:${ctx.playEpoch}`, value: 0 })
  const resetRate = el.add(el.const({ value: loopHz }), loopEpochZero)
  const rawReset = el.train(resetRate)
  const reset = el.mul(rawReset, ctx.playing)

  const sampleMeta = buildSampleMeta(doc.entities.samples, ctx.vfsLoadedHashes)
  const sampleHashById = buildSampleHashById(doc.entities.samples)

  const zero = el.const({ value: 0 })
  const voices: StereoOut[] = []

  for (const trackId of pattern.trackIds) {
    const track = doc.entities.tracks[trackId]
    const inst = doc.entities.instruments[track.instrumentId]
    const muted = ctx.mutedTracks?.[trackId] === true

    if (inst.kind === 'drumkit') {
      // Per-slot sequencing: each slot gets its own gate + freq sequences.
      const { slotGateSeqs, slotFreqSeqs } = buildDrumKitSlotSequences(track, pattern.length, inst)
      const { volumeSeq } = buildSequences(track, pattern.length)
      // Build effect modulation for drumkit (volume effects apply to the mix).
      const { volMod } = buildEffectSignals({}, [], pattern.length) // no effect lanes for drumkit
      // Rotate sequences so playback starts at ctx.startRow.
      const rotatedVol = rotateSeq(volumeSeq, ctx.startRow)
      const rotatedVolMod = rotateSeq(volMod, ctx.startRow)
      const vol = el.seq2({ key: `${trackId}:vol:${ctx.playEpoch}`, seq: rotatedVol, hold: true, loop: true }, clock, reset)
      const volModSeq = el.seq2({ key: `${trackId}:volMod:${ctx.playEpoch}`, seq: rotatedVolMod, hold: true, loop: true }, clock, reset)
      // Combine per-cell volume with effect volume modulation.
      const effVol = el.mul(vol, volModSeq)
      const masterGain = el.const({ value: inst.params.gain })

      let mixL: NodeRepr_t = zero
      let mixR: NodeRepr_t = zero
      for (const slot of inst.slots) {
        const rotatedGate = rotateSeq(slotGateSeqs[slot.id], ctx.startRow)
        const rotatedFreq = rotateSeq(slotFreqSeqs[slot.id], ctx.startRow)
        // hold:false so each hit produces a clean 0→1 edge for el.sample triggers.
        const slotGate = el.seq2({ key: `${trackId}:${slot.id}:gate:${ctx.playEpoch}`, seq: rotatedGate, hold: false, loop: true }, clock, reset)
        // hold:true so instrument release tails keep the correct frequency.
        const slotFreq = el.seq2({ key: `${trackId}:${slot.id}:freq:${ctx.playEpoch}`, seq: rotatedFreq, hold: true, loop: true }, clock, reset)
        const voice = renderDrumKitSlot(slot, doc.entities.instruments, slotGate, slotFreq, trackId, sampleMeta, sampleHashById, ctx.midiCcValues, ctx.paramRefs, ctx.ccBindings, inst.id)
        mixL = el.add(mixL, voice.left)
        mixR = el.add(mixR, voice.right)
      }

      voices.push(muted
        ? { left: el.mul(mixL, 0), right: el.mul(mixR, 0) }
        : { left: el.mul(mixL, effVol, masterGain), right: el.mul(mixR, effVol, masterGain) },
      )
      continue
    }

    // Osc / modular: single instrument per track.
    const { freqSeq, gateSeq, volumeSeq, effectLanes: laneSeqs, laneDefs } = buildSequences(track, pattern.length)
    const firstNote = track.cells.find((c) => c.note != null)?.note
    const trackBaseFreq = firstNote != null ? midiToFreq(firstNote) : 0

    // Build per-row effect modulation signals from built-in lane types.
    const { freqMul, volMod, pan } = buildEffectSignals(laneSeqs, laneDefs, pattern.length)

    // Rotate sequences so playback starts at ctx.startRow.
    const rotatedFreq = rotateSeq(freqSeq, ctx.startRow)
    const rotatedGate = rotateSeq(gateSeq, ctx.startRow)
    const rotatedVolume = rotateSeq(volumeSeq, ctx.startRow)
    const rotatedFreqMul = rotateSeq(freqMul, ctx.startRow)
    const rotatedVolMod = rotateSeq(volMod, ctx.startRow)
    const rotatedPan = rotateSeq(pan, ctx.startRow)

    // Rotate per-lane sequences.
    const rotatedLaneSeqs: Record<Id, number[]> = {}
    for (const [laneId, seq] of Object.entries(laneSeqs)) {
      rotatedLaneSeqs[laneId] = rotateSeq(seq, ctx.startRow)
    }

    const freq = el.seq2({ key: `${trackId}:freq:${ctx.playEpoch}`, seq: rotatedFreq, hold: true, loop: true }, clock, reset)
    const gate = el.seq2({ key: `${trackId}:gate:${ctx.playEpoch}`, seq: rotatedGate, hold: true, loop: true }, clock, reset)
    const vol = el.seq2({ key: `${trackId}:vol:${ctx.playEpoch}`, seq: rotatedVolume, hold: true, loop: true }, clock, reset)
    const freqMulSeq = el.seq2({ key: `${trackId}:freqMul:${ctx.playEpoch}`, seq: rotatedFreqMul, hold: true, loop: true }, clock, reset)
    const volModSeq = el.seq2({ key: `${trackId}:volMod:${ctx.playEpoch}`, seq: rotatedVolMod, hold: true, loop: true }, clock, reset)

    // Build per-lane seq2 nodes.
    const laneNodes: Record<Id, NodeRepr_t> = {}
    for (const [laneId, seq] of Object.entries(rotatedLaneSeqs)) {
      laneNodes[laneId] = el.seq2({
        key: `${trackId}:eff:${laneId}:${ctx.playEpoch}`,
        seq,
        hold: true,
        loop: true,
      }, clock, reset)
    }

    // Build inlet name → seq2 node map for named instrument inlets.
    // Named inlet lanes use the lane type as the inlet name.
    const inletSignals: Record<string, NodeRepr_t> = {}
    for (const lane of laneDefs) {
      if (!isBuiltinLaneType(lane.type)) {
        inletSignals[lane.type] = laneNodes[lane.id]
      }
    }

    // Apply effect modulation to frequency and volume.
    const { freq: effFreq, vol: effVol } = applyEffectModulation(freq, vol, freqMulSeq, volModSeq)

    const voice = renderInstrument(inst, effFreq, gate, trackId, sampleMeta, 0, sampleHashById, trackBaseFreq, effVol, inletSignals, ctx.midiCcValues, ctx.paramRefs, ctx.ccBindings)

    // Apply per-row panning if any row has a pan effect.
    const hasPan = pan.some((p) => p !== 0.5)
    if (hasPan && !muted) {
      // Convert 0..1 pan values to constant-power stereo gains.
      const panArr = rotatedPan
      const panSeq = el.seq2({ key: `${trackId}:pan:${ctx.playEpoch}`, seq: panArr, hold: true, loop: true }, clock, reset)
      const panAngle = el.mul(panSeq, Math.PI / 2)
      voices.push({ left: el.mul(voice.left, el.cos(panAngle)), right: el.mul(voice.right, el.sin(panAngle)) })
    } else {
      voices.push(muted
        ? { left: el.mul(voice.left, 0), right: el.mul(voice.right, 0) }
        : voice,
      )
    }
  }

  const mixL = voices.reduce((acc, v) => el.add(acc, v.left), zero)
  const mixR = voices.reduce((acc, v) => el.add(acc, v.right), zero)

  // Master gain, gated by play state. Preview sits outside the gate.
  const patternOut: StereoOut = {
    left: el.mul(mixL, ctx.playing, 0.3),
    right: el.mul(mixR, ctx.playing, 0.3),
  }

  return preview
    ? { left: el.add(patternOut.left, preview.left), right: el.add(patternOut.right, preview.right) }
    : patternOut
}
