import { describe, expect, it } from 'vitest'
import { chooseLiveSlot, liveGraphOptions, liveSlotValues, trackLiveSlot } from './liveSlot'
import { neutralSlotValues } from './playbackData'
import { computeSlotLayouts, DRUMKIT_CH, REGULAR_CH } from '../engine/voiceSlotLayout'
import { newDrumKitInstrument, newModularInstrument, newTrack, createDefaultDoc } from '../domain/factory'
import { midiToFreq } from '../domain/notes'
import type { Doc, DrumKitInstrument } from '../domain/types'

function docWith(inst: ReturnType<typeof newModularInstrument> | DrumKitInstrument): Doc {
  const doc = createDefaultDoc()
  doc.entities.instruments[inst.id] = inst
  const pat = doc.entities.patterns[doc.patternId]
  const t = newTrack(inst.id, pat.length)
  doc.entities.tracks[t.id] = t
  pat.trackIds.push(t.id)
  return doc
}

describe('liveSlotValues', () => {
  it('regular slot: gate, freq, velocity as vol, neutral effects', () => {
    const inst = newModularInstrument('Lead')
    const layout = computeSlotLayouts(docWith(inst)).find((l) => l.instId === inst.id)!
    const on = liveSlotValues(layout, inst, 69, 127, true)!
    expect(on.gates).toBe(1)
    expect(on.values[REGULAR_CH.gate]).toBe(1)
    expect(on.values[REGULAR_CH.freq]).toBeCloseTo(440)
    expect(on.values[REGULAR_CH.vol]).toBe(1)
    const neutral = neutralSlotValues(layout)
    expect(on.values[REGULAR_CH.panning]).toBe(neutral[REGULAR_CH.panning])
    expect(on.values[REGULAR_CH.staccato]).toBe(1)

    const off = liveSlotValues(layout, inst, 69, 64, false)!
    expect(off.values[REGULAR_CH.gate]).toBe(0)
    expect(off.values[REGULAR_CH.freq]).toBeCloseTo(440)
  })

  it('drum kit: gates only the drum mapped to the note', () => {
    const kit = newDrumKitInstrument('Kit')
    const drum = { sampleId: 'smp', instrumentId: null, volume: 1, pan: 0 }
    kit.slots = [
      { ...drum, id: 'a', note: 36, baseNote: 60 },
      { ...drum, id: 'b', note: 38, baseNote: 48 },
    ] as DrumKitInstrument['slots']
    const layout = computeSlotLayouts(docWith(kit)).find((l) => l.instId === kit.id)!
    const v = liveSlotValues(layout, kit, 39, 127, true)!
    expect(v.gates).toBe(2)
    expect(v.values.slice(0, 2)).toEqual([0, 1])
    expect(v.values[3]).toBeCloseTo(midiToFreq(49)) // baseNote 48 + 1 key above 38
    expect(v.values[4 + DRUMKIT_CH.vol]).toBe(1)
    expect(liveSlotValues(layout, kit, 20, 127, true)).toBeNull() // below every drum
  })
})

describe('chooseLiveSlot', () => {
  it('uses the preferred slot when valid', () => {
    expect(chooseLiveSlot(4, [2], 0, 2)).toBe(2)
    expect(chooseLiveSlot(4, [], 0, 9)).toBe(1)
  })

  it('rotates past the last slot and skips held ones', () => {
    expect(chooseLiveSlot(4, [], 1)).toBe(2)
    expect(chooseLiveSlot(4, [2, 3], 1)).toBe(0)
  })

  it('steals the longest-held slot when all are busy', () => {
    expect(chooseLiveSlot(3, [1, 0, 2], 2)).toBe(1)
  })

  it('returns -1 without slots', () => {
    expect(chooseLiveSlot(0, [], 0)).toBe(-1)
  })
})

describe('liveGraphOptions', () => {
  it('free play: live voices for the current instrument only', () => {
    expect(liveGraphOptions(true, 'i1')).toEqual({ liveVoiceInstIds: ['i1'], ensureSlotInstId: null })
  })

  it('free play off: no live voices, the current instrument gets a slot', () => {
    expect(liveGraphOptions(false, 'i1')).toEqual({ liveVoiceInstIds: [], ensureSlotInstId: 'i1' })
    expect(liveGraphOptions(true, null)).toEqual({ liveVoiceInstIds: [], ensureSlotInstId: null })
  })
})

describe('trackLiveSlot', () => {
  it("returns the cursor track's slot only when it plays that instrument", () => {
    const inst = newModularInstrument('Lead')
    const doc = docWith(inst)
    const pat = doc.entities.patterns[doc.patternId]
    const second = newTrack(inst.id, pat.length)
    doc.entities.tracks[second.id] = second
    pat.trackIds.push(second.id)

    expect(trackLiveSlot(doc, second.id, inst.id)).toBe(1)
    expect(trackLiveSlot(doc, second.id, 'other')).toBeUndefined()
    expect(trackLiveSlot(doc, undefined, inst.id)).toBeUndefined()
  })
})
