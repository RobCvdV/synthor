import { el } from '@elemaudio/core'
import type { Doc, Id, SampleEntity } from '../domain/types'
import { midiToFreq } from '../domain/notes'
import { buildSequences } from './sequences'
import { renderInstrument } from './instruments'
import type { StereoOut } from './modular'

/** Build the sorted sample metadata list for sampleIndex → VFS key + channels resolution.
 *  Only includes samples whose data is actually loaded in Elementary's VFS. */
function buildSampleMeta(
  samples: Record<Id, SampleEntity>,
  vfsLoaded?: Set<string>,
): { hash: string; channels: number }[] {
  return Object.values(samples)
    .filter((s) => !vfsLoaded || vfsLoaded.has(s.hash))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ hash: s.hash, channels: s.channels }))
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

  const voices = preview.voices.map((v) => {
    const voiceKey = `preview:${inst.id}:${v.note}`
    const freq = el.const({ key: `${voiceKey}:freq`, value: midiToFreq(v.note) })
    const gate = el.const({ key: `${voiceKey}:gate`, value: v.gate })
    const note = inst.kind === 'drumkit'
      ? el.const({ key: `${voiceKey}:note`, value: v.note })
      : 0
    return renderInstrument(inst, freq, gate, voiceKey, sampleMeta, note, sampleHashById, midiToFreq(v.note))
  })
  const zero = el.const({ value: 0 })
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

  const voices = pattern.trackIds.map((trackId) => {
    const track = doc.entities.tracks[trackId]
    const inst = doc.entities.instruments[track.instrumentId]
    const { freqSeq, gateSeq, volumeSeq, noteSeq } = buildSequences(track, pattern.length)

    const freq = el.seq2({ key: `${trackId}:freq`, seq: freqSeq, hold: true, loop: true }, clock, reset)
    const gate = el.seq2({ key: `${trackId}:gate`, seq: gateSeq, hold: true, loop: true }, clock, reset)
    const vol = el.seq2({ key: `${trackId}:vol`, seq: volumeSeq, hold: true, loop: true }, clock, reset)
    // Only drumkit instruments need the raw MIDI note signal.
    const noteSig = inst.kind === 'drumkit'
      ? el.seq2({ key: `${trackId}:note`, seq: noteSeq.map((n) => n ?? 0), hold: true, loop: true }, clock, reset)
      : 0

    const voice = renderInstrument(inst, freq, gate, trackId, sampleMeta, noteSig, sampleHashById, 0, vol)
    const muted = ctx.mutedTracks?.[trackId] === true
    return muted
      ? { left: el.mul(voice.left, 0), right: el.mul(voice.right, 0) }
      : voice
  })

  const zero = el.const({ value: 0 })
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
