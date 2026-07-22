import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc, Id, SampleEntity } from '../domain/types'
import { getSlotForNote } from '../domain/types'
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
): StereoOut | null {
  if (!preview || preview.voices.length === 0) return null
  const inst = doc.entities.instruments[preview.instrumentId]
  if (!inst) return null

  const sampleMeta = buildSampleMeta(doc.entities.samples, vfsLoaded)
  const sampleHashById = buildSampleHashById(doc.entities.samples)
  const zero = el.const({ value: 0 })

  // Drumkit preview: each voice maps to a single slot via getSlotForNote.
  if (inst.kind === 'drumkit') {
    const voices = preview.voices.map((v) => {
      const slot = getSlotForNote(inst, v.note)
      if (!slot) return { left: zero, right: zero }
      const voiceKey = `preview:${inst.id}:${v.note}`
      // Drum samples don't pitch-track to the played key — the note only
      // selects which slot fires. Playback speed = slot.note + pitchOffset.
      const freq = el.const({ key: `${voiceKey}:freq`, value: midiToFreq(slot.note + slot.pitchOffset) })
      const gate = el.const({ key: `${voiceKey}:gate`, value: v.gate })
      return renderDrumKitSlot(slot, doc.entities.instruments, gate, freq, voiceKey, sampleMeta, sampleHashById)
    })
    const masterGain = el.const({ value: inst.params.gain })
    return {
      left: el.mul(voices.reduce((a, v) => el.add(a, v.left), zero), 0.3, masterGain),
      right: el.mul(voices.reduce((a, v) => el.add(a, v.right), zero), 0.3, masterGain),
    }
  }

  const voices = preview.voices.map((v) => {
    const voiceKey = `preview:${inst.id}:${v.note}`
    const freq = el.const({ key: `${voiceKey}:freq`, value: midiToFreq(v.note) })
    const gate = el.const({ key: `${voiceKey}:gate`, value: v.gate })
    const note = 0
    return renderInstrument(inst, freq, gate, voiceKey, sampleMeta, note, sampleHashById, midiToFreq(v.note))
  })
  return {
    left: el.mul(voices.reduce((a, v) => el.add(a, v.left), zero), 0.3),
    right: el.mul(voices.reduce((a, v) => el.add(a, v.right), zero), 0.3),
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
  const preview = compilePreview(doc, ctx.preview, ctx.vfsLoadedHashes)
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
      const { volumeSeq, effectSeq } = buildSequences(track, pattern.length)
      // Build effect modulation for drumkit (volume + pan effects apply to the mix).
      const { volMod } = buildEffectSignals(effectSeq, pattern.length)
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
        const voice = renderDrumKitSlot(slot, doc.entities.instruments, slotGate, slotFreq, trackId, sampleMeta, sampleHashById)
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
    const { freqSeq, gateSeq, volumeSeq, effectSeq } = buildSequences(track, pattern.length)
    const firstNote = track.cells.find((c) => c.note != null)?.note
    const trackBaseFreq = firstNote != null ? midiToFreq(firstNote) : 0

    // Build per-row effect modulation signals.
    const { freqMul, volMod, pan } = buildEffectSignals(effectSeq, pattern.length)

    // Rotate sequences so playback starts at ctx.startRow.
    const rotatedFreq = rotateSeq(freqSeq, ctx.startRow)
    const rotatedGate = rotateSeq(gateSeq, ctx.startRow)
    const rotatedVolume = rotateSeq(volumeSeq, ctx.startRow)
    const rotatedFreqMul = rotateSeq(freqMul, ctx.startRow)
    const rotatedVolMod = rotateSeq(volMod, ctx.startRow)
    const rotatedPan = rotateSeq(pan, ctx.startRow)

    const freq = el.seq2({ key: `${trackId}:freq:${ctx.playEpoch}`, seq: rotatedFreq, hold: true, loop: true }, clock, reset)
    const gate = el.seq2({ key: `${trackId}:gate:${ctx.playEpoch}`, seq: rotatedGate, hold: true, loop: true }, clock, reset)
    const vol = el.seq2({ key: `${trackId}:vol:${ctx.playEpoch}`, seq: rotatedVolume, hold: true, loop: true }, clock, reset)
    const freqMulSeq = el.seq2({ key: `${trackId}:freqMul:${ctx.playEpoch}`, seq: rotatedFreqMul, hold: true, loop: true }, clock, reset)
    const volModSeq = el.seq2({ key: `${trackId}:volMod:${ctx.playEpoch}`, seq: rotatedVolMod, hold: true, loop: true }, clock, reset)

    // Apply effect modulation to frequency and volume.
    const { freq: effFreq, vol: effVol } = applyEffectModulation(freq, vol, freqMulSeq, volModSeq)

    const voice = renderInstrument(inst, effFreq, gate, trackId, sampleMeta, 0, sampleHashById, trackBaseFreq, effVol)

    // Apply per-row panning if any row has a pan effect.
    const hasPan = pan.some((p) => p !== null)
    if (hasPan && !muted) {
      // Convert null→0.5 (center) for rows without panning.
      const panArr = rotatedPan.map((p) => p ?? 0.5)
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
