/**
 * Live notes through the txSeq node: the signal vector a slot plays for a
 * held key, and which of an instrument's slots takes it. Pure.
 */

import type { Doc, Id, Instrument } from '../domain/types'
import { getSlotForNote } from '../domain/types'
import { midiToFreq } from '../domain/notes'
import { DRUMKIT_CH, REGULAR_CH, type InstrumentSlotLayout } from '../engine/voiceSlotLayout'
import { mapPatternTracksToSlots, neutralSlotValues } from './playbackData'

/** Payload of a txSeq `live` command (slot = global slot index). */
export interface LiveSlotValues {
  gates: number
  values: number[]
}

/** Slot values for a live note, or null when a drum kit has no sound for it. */
export function liveSlotValues(
  layout: InstrumentSlotLayout,
  inst: Instrument,
  note: number,
  velocity: number,
  gateOn: boolean,
): LiveSlotValues | null {
  const values = neutralSlotValues(layout)
  const vol = Math.max(0, Math.min(1, velocity / 127))

  if (layout.isDrumkit) {
    if (inst.kind !== 'drumkit') return null
    const drumSounds = layout.drumSounds ?? 0
    const slot = getSlotForNote(inst, note)
    const d = slot ? inst.slots.findIndex((s) => s.id === slot.id) : -1
    if (!slot || d < 0 || d >= drumSounds) return null
    values[d] = gateOn ? 1 : 0
    values[drumSounds + d] = midiToFreq(slot.baseNote + (note - slot.note))
    values[2 * drumSounds + DRUMKIT_CH.vol] = vol
    return { gates: drumSounds, values }
  }

  values[REGULAR_CH.gate] = gateOn ? 1 : 0
  values[REGULAR_CH.freq] = midiToFreq(note)
  values[REGULAR_CH.vol] = vol
  return { gates: 1, values }
}

/**
 * Pick the slot (0..slotCount-1) for a new live note: the preferred slot if
 * given, else the next free one after `lastSlot` (so release tails ring on),
 * else steal the longest-held. `held` is in note-on order.
 */
export function chooseLiveSlot(
  slotCount: number,
  held: readonly number[],
  lastSlot: number,
  preferred?: number,
): number {
  if (slotCount <= 0) return -1
  if (preferred !== undefined && preferred >= 0 && preferred < slotCount) return preferred
  for (let i = 1; i <= slotCount; i++) {
    const s = (lastSlot + i) % slotCount
    if (!held.includes(s)) return s
  }
  return held[0] ?? 0
}

/** Graph options for live play: free play gives only the current instrument
 *  its own voices; otherwise it gets a guaranteed tracker slot instead. */
export function liveGraphOptions(
  freePlay: boolean,
  currentInstId: Id | null,
): { liveVoiceInstIds: Id[]; ensureSlotInstId: Id | null } {
  return {
    liveVoiceInstIds: freePlay && currentInstId ? [currentInstId] : [],
    ensureSlotInstId: freePlay ? null : currentInstId,
  }
}

/** The tracker slot of `trackId` in the current pattern, if it plays `instId`. */
export function trackLiveSlot(doc: Doc, trackId: Id | undefined, instId: Id): number | undefined {
  if (!trackId || doc.entities.tracks[trackId]?.instrumentId !== instId) return undefined
  return mapPatternTracksToSlots(doc, doc.patternId).get(trackId)
}
