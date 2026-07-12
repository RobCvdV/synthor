import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc } from '../domain/types'
import { buildSequences } from './sequences'
import { renderInstrument } from './instruments'

/** Everything the compiler needs from the transport, as plain data. */
export interface RenderContext {
  /** Rows advanced per second (from tempo). */
  rowHz: number
  /** 1 while playing, 0 when stopped (silences output without tearing down). */
  playing: number
  /** Muted track ids. Muted voices are gained to 0 but kept in the graph so
   *  their sequencer phase is preserved across mute/unmute. */
  mutedTracks?: Record<string, boolean>
}

/**
 * The heart of the engine: a pure function from document + transport to an
 * Elementary signal graph. No React, no Zustand, no AudioContext — which makes
 * it unit-testable and reusable for offline bounce or headless playback.
 *
 * Returns a single mono node; the host sends it to both output channels.
 */
export function compileGraph(doc: Doc, ctx: RenderContext): NodeRepr_t {
  const pattern = doc.entities.patterns[doc.patternId]
  if (!pattern || pattern.trackIds.length === 0) {
    return el.const({ value: 0 })
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

  // Master gain, gated by play state so stopping is instant silence.
  return el.mul(mix, ctx.playing, 0.3)
}
