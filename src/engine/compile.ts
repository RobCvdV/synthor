import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc, Id, SampleEntity } from '../domain/types'
import { getSlotForNote } from '../domain/types'
import { midiToFreq } from '../domain/notes'
import { buildDrumKitSlotSequences, buildSequences } from './sequences'
import { renderDrumKitSlot, renderInstrument } from './instruments'
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

  const clock = el.train(ctx.rowHz)
  const loopHz = ctx.rowHz / pattern.length
  const reset = el.train(loopHz)
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
      const vol = el.seq2({ key: `${trackId}:vol`, seq: volumeSeq, hold: true, loop: true }, clock, reset)
      const masterGain = el.const({ value: inst.params.gain })

      let mixL: NodeRepr_t = zero
      let mixR: NodeRepr_t = zero
      for (const slot of inst.slots) {
        // hold:false so each hit produces a clean 0→1 edge for el.sample triggers.
        const slotGate = el.seq2({ key: `${trackId}:${slot.id}:gate`, seq: slotGateSeqs[slot.id], hold: false, loop: true }, clock, reset)
        // hold:true so instrument release tails keep the correct frequency.
        const slotFreq = el.seq2({ key: `${trackId}:${slot.id}:freq`, seq: slotFreqSeqs[slot.id], hold: true, loop: true }, clock, reset)
        const voice = renderDrumKitSlot(slot, doc.entities.instruments, slotGate, slotFreq, trackId, sampleMeta, sampleHashById)
        mixL = el.add(mixL, voice.left)
        mixR = el.add(mixR, voice.right)
      }

      voices.push(muted
        ? { left: el.mul(mixL, 0), right: el.mul(mixR, 0) }
        : { left: el.mul(mixL, vol, masterGain), right: el.mul(mixR, vol, masterGain) },
      )
      continue
    }

    // Osc / modular: single instrument per track.
    const { freqSeq, gateSeq, volumeSeq } = buildSequences(track, pattern.length)
    const firstNote = track.cells.find((c) => c.note != null)?.note
    const trackBaseFreq = firstNote != null ? midiToFreq(firstNote) : 0

    const freq = el.seq2({ key: `${trackId}:freq`, seq: freqSeq, hold: true, loop: true }, clock, reset)
    const gate = el.seq2({ key: `${trackId}:gate`, seq: gateSeq, hold: true, loop: true }, clock, reset)
    const vol = el.seq2({ key: `${trackId}:vol`, seq: volumeSeq, hold: true, loop: true }, clock, reset)

    const voice = renderInstrument(inst, freq, gate, trackId, sampleMeta, 0, sampleHashById, trackBaseFreq, vol)
    voices.push(muted
      ? { left: el.mul(voice.left, 0), right: el.mul(voice.right, 0) }
      : voice,
    )
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
