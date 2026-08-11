import { describe, expect, it } from 'vitest'
import { computeSlotLayouts, totalChannels, getSlotChannelOffset } from '../engine/voiceSlotLayout'
import { newOscInstrument, newDrumKitInstrument, newTrack } from '../domain/factory'
import type { Doc, Id, Pattern } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'

/** Build a minimal doc for slot layout testing. */
function makeDoc(
  instruments: Record<Id, any>,
  tracks: Record<Id, any>,
  patterns: Record<Id, Pattern>,
): Doc {
  return {
    entities: {
      instruments,
      tracks,
      patterns,
      sections: {},
      samples: {},
      mixChannels: { [MASTER_CHANNEL_ID]: { id: MASTER_CHANNEL_ID, name: 'Master', kind: 'master', volume: 1, pan: 0, mute: false, solo: false, effects: [] } },
      mixerInstrumentOrder: Object.keys(instruments),
    },
    patternId: Object.keys(patterns)[0] ?? 'no_pattern',
    sectionIds: [],
  }
}

describe('computeSlotLayouts', () => {
  it('returns empty for doc with no patterns', () => {
    const inst = newOscInstrument('Bass')
    const doc = makeDoc({ [inst.id]: inst }, {}, {})
    expect(computeSlotLayouts(doc)).toEqual([])
  })

  it('computes 1 slot for an instrument used once in one pattern', () => {
    const inst = newOscInstrument('Bass')
    const track = newTrack(inst.id, 64)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 64, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const layouts = computeSlotLayouts(doc)
    expect(layouts).toHaveLength(1)
    expect(layouts[0].instId).toBe(inst.id)
    expect(layouts[0].slotCount).toBe(1)
    expect(layouts[0].isDrumkit).toBe(false)
    // Regular: 11 base channels, no named inlets.
    expect(layouts[0].channelsPerSlot).toBe(11)
    expect(layouts[0].baseChannel).toBe(0)
  })

  it('computes 2 slots when two tracks use the same instrument in one pattern', () => {
    const inst = newOscInstrument('Lead')
    const t1 = newTrack(inst.id, 64)
    const t2 = newTrack(inst.id, 64)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 64, trackIds: [t1.id, t2.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [t1.id]: t1, [t2.id]: t2 }, { [pattern.id]: pattern })

    const layouts = computeSlotLayouts(doc)
    expect(layouts).toHaveLength(1)
    expect(layouts[0].slotCount).toBe(2)
    // 2 slots × 11 channels = 22 total.
    expect(totalChannels(layouts)).toBe(22)
  })

  it('takes max concurrent tracks across multiple patterns', () => {
    const inst = newOscInstrument('Lead')
    const t1 = newTrack(inst.id, 64)
    const t2 = newTrack(inst.id, 64)
    const t3 = newTrack(inst.id, 64)
    // Pattern 1: 1 lead track, Pattern 2: 2 lead tracks, Pattern 3: 1 lead track.
    const p1: Pattern = { id: 'pat_1', name: 'P1', length: 32, trackIds: [t1.id] }
    const p2: Pattern = { id: 'pat_2', name: 'P2', length: 32, trackIds: [t2.id, t3.id] }
    const doc = makeDoc(
      { [inst.id]: inst },
      { [t1.id]: t1, [t2.id]: t2, [t3.id]: t3 },
      { [p1.id]: p1, [p2.id]: p2 },
    )

    const layouts = computeSlotLayouts(doc)
    expect(layouts[0].slotCount).toBe(2)
  })

  it('handles multiple instruments with different concurrency', () => {
    const bass = newOscInstrument('Bass')
    const lead = newOscInstrument('Lead')
    const drums = newDrumKitInstrument('Drums')
    // Add 4 drum slots to ensure channel count is non-trivial.
    drums.slots = [
      { id: 'slot_0', note: 36, sampleId: null, instrumentId: null, baseNote: 36, volume: 1, pan: 0 },
      { id: 'slot_1', note: 38, sampleId: null, instrumentId: null, baseNote: 38, volume: 1, pan: 0 },
      { id: 'slot_2', note: 42, sampleId: null, instrumentId: null, baseNote: 42, volume: 1, pan: 0 },
      { id: 'slot_3', note: 46, sampleId: null, instrumentId: null, baseNote: 46, volume: 1, pan: 0 },
    ]

    const bt = newTrack(bass.id, 64)
    const l1 = newTrack(lead.id, 64)
    const l2 = newTrack(lead.id, 64)
    const dt = newTrack(drums.id, 64)
    const p1: Pattern = { id: 'pat_1', name: 'P1', length: 64, trackIds: [bt.id, l1.id, l2.id, dt.id] }
    const doc = makeDoc(
      { [bass.id]: bass, [lead.id]: lead, [drums.id]: drums },
      { [bt.id]: bt, [l1.id]: l1, [l2.id]: l2, [dt.id]: dt },
      { [p1.id]: p1 },
    )

    const layouts = computeSlotLayouts(doc)
    expect(layouts).toHaveLength(3)

    // Bass: 1 slot × 11ch.
    const bassLayout = layouts.find((l) => l.instId === bass.id)!
    expect(bassLayout.slotCount).toBe(1)
    expect(bassLayout.channelsPerSlot).toBe(11)

    // Lead: 2 slots × 11ch.
    const leadLayout = layouts.find((l) => l.instId === lead.id)!
    expect(leadLayout.slotCount).toBe(2)
    expect(leadLayout.channelsPerSlot).toBe(11)

    // Drums: 1 slot × (4 drum sounds + 10) = 14 channels.
    const drumLayout = layouts.find((l) => l.instId === drums.id)!
    expect(drumLayout.slotCount).toBe(1)
    expect(drumLayout.isDrumkit).toBe(true)
    expect(drumLayout.drumSounds).toBe(4)
    expect(drumLayout.channelsPerSlot).toBe(18) // 2*4 + 10

    // Channel assignment depends on sorted inst IDs; with UUIDs the order varies.
    // All we assert is each instrument gets its expected slot count and the
    // total accounts for 32-channel boundary alignment.
    const total = totalChannels(layouts)
    expect(total).toBeGreaterThanOrEqual(47) // at least 11+22+14 without padding
    expect(total).toBeLessThanOrEqual(78)    // max with worst-case padding
  })

  it('includes named inlets from effect lanes', () => {
    const inst = newOscInstrument('Synth')
    const track = newTrack(inst.id, 64)
    // Add a named inlet lane (not a built-in type).
    track.effectLanes = [
      { id: 'lan_1', type: 'customInlet' },
      { id: 'lan_2', type: 'anotherInlet' },
    ]
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 64, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const layouts = computeSlotLayouts(doc)
    expect(layouts).toHaveLength(1)
    // 11 base + 2 named inlets.
    expect(layouts[0].channelsPerSlot).toBe(13)
    expect(layouts[0].namedInletIds).toEqual(['anotherInlet', 'customInlet']) // sorted
  })

  it('named inlets are unioned across all tracks of the instrument', () => {
    const inst = newOscInstrument('Synth')
    const t1 = newTrack(inst.id, 64)
    t1.effectLanes = [{ id: 'lan_a', type: 'cutoff' }]
    const t2 = newTrack(inst.id, 64)
    t2.effectLanes = [{ id: 'lan_b', type: 'resonance' }]
    // Different patterns so they don't overlap.
    const p1: Pattern = { id: 'pat_1', name: 'P1', length: 32, trackIds: [t1.id] }
    const p2: Pattern = { id: 'pat_2', name: 'P2', length: 32, trackIds: [t2.id] }
    const doc = makeDoc(
      { [inst.id]: inst },
      { [t1.id]: t1, [t2.id]: t2 },
      { [p1.id]: p1, [p2.id]: p2 },
    )

    const layouts = computeSlotLayouts(doc)
    // Both tracks use the same instrument but in different patterns → 1 slot.
    expect(layouts[0].slotCount).toBe(1)
    // Union of named inlets: cutoff + resonance.
    expect(layouts[0].namedInletIds).toEqual(['cutoff', 'resonance'])
    expect(layouts[0].channelsPerSlot).toBe(13) // 11 + 2
  })

  it('skips tracks with no instrument', () => {
    const inst = newOscInstrument('Bass')
    const track = newTrack(inst.id, 64)
    // Break the instrument reference — track points to missing instrument.
    track.instrumentId = 'nonexistent'
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 64, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const layouts = computeSlotLayouts(doc)
    // The track's instrument doesn't exist, so it's not counted.
    expect(layouts).toHaveLength(0)
  })
})

describe('getSlotChannelOffset', () => {
  it('returns the correct global offset for a slot', () => {
    const inst = newOscInstrument('Lead')
    const t1 = newTrack(inst.id, 64)
    const t2 = newTrack(inst.id, 64)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 64, trackIds: [t1.id, t2.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [t1.id]: t1, [t2.id]: t2 }, { [pattern.id]: pattern })

    const layouts = computeSlotLayouts(doc)
    // 2 slots × 11ch = 22ch. 0 % 32 + 22 = 22 ≤ 32, so no alignment needed.
    // Slot 0 → channel 0, Slot 1 → channel 11.
    expect(getSlotChannelOffset(layouts, inst.id, 0)).toBe(0)
    expect(getSlotChannelOffset(layouts, inst.id, 1)).toBe(11)
  })

  it('returns 0 for unknown instrument', () => {
    const layouts = computeSlotLayouts(makeDoc({}, {}, {}))
    expect(getSlotChannelOffset(layouts, 'nope', 0)).toBe(0)
  })
})
