import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc, Id } from '../domain/types'
import { midiToFreq } from '../domain/notes'
import { buildSequences } from './sequences'
import { renderInstrument } from './instruments'

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
}

/**
 * Live-preview voices for the instrument editor. Each held/releasing note is a
 * voice keyed uniquely (per note) so polyphony reconciles cleanly and doesn't
 * collide with the shared instrument's pattern voices. Returns null when there
 * is nothing to preview, so the pattern-only graph is left untouched.
 */
function compilePreview(doc: Doc, preview: RenderContext['preview']): NodeRepr_t | null {
  if (!preview || preview.voices.length === 0) return null
  const inst = doc.entities.instruments[preview.instrumentId]
  if (!inst) return null

  const voices = preview.voices.map((v) => {
    const voiceKey = `preview:${inst.id}:${v.note}`
    const freq = el.const({ key: `${voiceKey}:freq`, value: midiToFreq(v.note) })
    const gate = el.const({ key: `${voiceKey}:gate`, value: v.gate })
    return renderInstrument(inst, freq, gate, voiceKey)
  })
  return el.mul(voices.reduce((a, b) => el.add(a, b)), 0.3)
}

/**
 * The heart of the engine: a pure function from document + transport to an
 * Elementary signal graph. No React, no Zustand, no AudioContext — which makes
 * it unit-testable and reusable for offline bounce or headless playback.
 *
 * Returns a single mono node; the host sends it to both output channels.
 */
export function compileGraph(doc: Doc, ctx: RenderContext): NodeRepr_t {
  const preview = compilePreview(doc, ctx.preview)
  const pattern = doc.entities.patterns[doc.patternId]
  if (!pattern || pattern.trackIds.length === 0) {
    // No pattern to play, but a held preview note should still sound.
    return preview ?? el.const({ value: 0 })
  }

  // One global row clock drives every track's sequencer in lockstep.
  const clock = el.train(ctx.rowHz)

  // Shared, phase-locked loop reset. Each el.seq2 keeps its own step counter
  // that starts at 0 when the *node* is created, so a track added mid-playback
  // would otherwise be permanently out of phase with the others. A single reset
  // train — one rising edge at each pattern-loop boundary, shared by every
  // sequencer — snaps all counters (old and newly created) back to row 0
  // together at the boundary, keeping every track mutually aligned regardless
  // of when it was added. seq2's reset is rising-edge triggered, so the train's
  // 50% duty does not freeze the sequence between boundaries (verified).
  const loopHz = ctx.rowHz / pattern.length
  const reset = el.train(loopHz)

  const voices = pattern.trackIds.map((trackId) => {
    const track = doc.entities.tracks[trackId]
    const inst = doc.entities.instruments[track.instrumentId]
    const { freqSeq, gateSeq } = buildSequences(track, pattern.length)

    const freq = el.seq2({ key: `${trackId}:freq`, seq: freqSeq, hold: true, loop: true }, clock, reset)
    // hold:true so the gate stays high for the whole row — the rising edge
    // opens the ADSR and the fall to 0 on the next row closes it. (hold:false
    // would emit a 1-sample impulse that never opens the envelope → silence.)
    const gate = el.seq2({ key: `${trackId}:gate`, seq: gateSeq, hold: true, loop: true }, clock, reset)

    const voice = renderInstrument(inst, freq, gate, trackId)
    const muted = ctx.mutedTracks?.[trackId] === true
    return muted ? el.mul(voice, 0) : voice
  })

  const mix = voices.reduce((acc, v) => el.add(acc, v))

  // Master gain, gated by play state so stopping is instant silence. The
  // preview sits outside that gate so it sounds while the transport is stopped.
  const patternOut = el.mul(mix, ctx.playing, 0.3)
  return preview ? el.add(patternOut, preview) : patternOut
}
