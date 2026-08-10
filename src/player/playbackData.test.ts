import { describe, expect, it } from 'vitest'
import { buildPlaybackData } from '../player/playbackData'
import { newOscInstrument, newDrumKitInstrument, newTrack } from '../domain/factory'
import type { Doc, Id, Pattern, Track } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { REGULAR_CH } from '../engine/voiceSlotLayout'

/** Build a minimal doc for testing. */
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

/** Helper: set a MIDI note on a cell. */
function setNote(track: Track, row: number, note: number): void {
  track.cells[row].note = note
  track.cells[row].hold = false
}

describe('buildPlaybackData', () => {
  it('builds slot data for a single pattern with one instrument', () => {
    const inst = newOscInstrument('Bass')
    const track = newTrack(inst.id, 4)
    setNote(track, 0, 60)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    expect(data.slots).toHaveLength(1)
    expect(data.totalRows).toBe(4)

    const slot = data.slots[0]
    expect(slot.instId).toBe(inst.id)
    expect(slot.slotIndex).toBe(0)
    expect(slot.channelOffset).toBe(0)
    expect(slot.drumGateCount).toBe(0)

    // Gate=1 on row 0, 0 elsewhere.
    expect(slot.signals[REGULAR_CH.gate][0]).toBe(1)
    expect(slot.signals[REGULAR_CH.gate][1]).toBe(0)
    expect(slot.signals[REGULAR_CH.gate][2]).toBe(0)
    expect(slot.signals[REGULAR_CH.gate][3]).toBe(0)

    // Freq is set on all rows (carry-forward for release phase).
    expect(slot.signals[REGULAR_CH.freq][0]).toBeGreaterThan(0)
    expect(slot.signals[REGULAR_CH.freq][1]).toBeGreaterThan(0)

    // Vol defaults to 1.
    expect(slot.signals[REGULAR_CH.vol][0]).toBe(1)
  })

  it('builds slot data for two tracks using same instrument (2 slots)', () => {
    const inst = newOscInstrument('Lead')
    const t1 = newTrack(inst.id, 4)
    const t2 = newTrack(inst.id, 4)
    setNote(t1, 0, 60)
    setNote(t2, 2, 64)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [t1.id, t2.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [t1.id]: t1, [t2.id]: t2 }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    expect(data.slots).toHaveLength(2)

    // Slot 0 gets track t1's data, slot 1 gets track t2's data.
    const s0 = data.slots.find((s) => s.slotIndex === 0)!
    const s1 = data.slots.find((s) => s.slotIndex === 1)!
    expect(s0.channelOffset).toBe(0)
    expect(s1.channelOffset).toBe(11)

    // t1 note at row 0 → slot 0 gate[0] = 1.
    expect(s0.signals[REGULAR_CH.gate][0]).toBe(1)
    expect(s0.signals[REGULAR_CH.gate][2]).toBe(0)

    // t2 note at row 2 → slot 1 gate[2] = 1.
    expect(s1.signals[REGULAR_CH.gate][2]).toBe(1)
  })

  it('reuses slots across non-overlapping pattern windows', () => {
    const inst = newOscInstrument('Bass')
    const t1 = newTrack(inst.id, 32)
    const t2 = newTrack(inst.id, 32)
    setNote(t1, 0, 60)
    setNote(t2, 0, 64)
    const p1: Pattern = { id: 'pat_1', name: 'P1', length: 32, trackIds: [t1.id] }
    const p2: Pattern = { id: 'pat_2', name: 'P2', length: 32, trackIds: [t2.id] }
    const doc = makeDoc(
      { [inst.id]: inst },
      { [t1.id]: t1, [t2.id]: t2 },
      { [p1.id]: p1, [p2.id]: p2 },
    )

    // Song: P1 at rows 0-31, P2 at rows 32-63.
    const data = buildPlaybackData(doc, [
      { patternId: p1.id, startRow: 0 },
      { patternId: p2.id, startRow: 32 },
    ])

    // Only 1 slot needed since tracks don't overlap.
    expect(data.slots).toHaveLength(1)
    expect(data.totalRows).toBe(64)

    const slot = data.slots[0]
    // t1 note at row 0 → gate[0] = 1.
    expect(slot.signals[REGULAR_CH.gate][0]).toBe(1)
    // Gap between patterns (default silence).
    expect(slot.signals[REGULAR_CH.gate][1]).toBe(0)
    expect(slot.signals[REGULAR_CH.gate][31]).toBe(0)
    // t2 note at row 32 → gate[32] = 1 (relative to pattern start).
    expect(slot.signals[REGULAR_CH.gate][32]).toBe(1)
  })

  it('maps effect lane values to correct channel positions', () => {
    const inst = newOscInstrument('Synth')
    const track = newTrack(inst.id, 4)
    setNote(track, 0, 60)
    // Add a panning effect lane.
    track.effectLanes = [{ id: 'lan_pan', type: 'panning' }]
    // Set panning value on row 1.
    track.cells[1].effectLanes['lan_pan'] = 0.75
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    const slot = data.slots[0]

    // Panning is at channel 5 (REGULAR_CH.panning).
    expect(slot.signals[REGULAR_CH.panning][0]).toBe(0.5) // default
    expect(slot.signals[REGULAR_CH.panning][1]).toBe(0.75) // from lane
  })

  it('maps named inlet values to correct positions', () => {
    const inst = newOscInstrument('Synth')
    const track = newTrack(inst.id, 4)
    setNote(track, 0, 60)
    const inletName = 'cutoffFilter'
    track.effectLanes = [{ id: 'lan_cf', type: inletName }]
    track.cells[0].effectLanes['lan_cf'] = 0.3
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    const slot = data.slots[0]

    // Named inlet starts at channel 11.
    expect(slot.signals[11][0]).toBe(0.3)
    expect(slot.signals[11][1]).toBe(0) // no value set
  })

  it('builds drumkit slot data with per-sound gate channels', () => {
    const drums = newDrumKitInstrument('Drums')
    drums.slots = [
      { id: 'dkick', note: 36, sampleId: null, instrumentId: null, pitchOffset: 0, gain: 1, pan: 0 },
      { id: 'dsnare', note: 38, sampleId: null, instrumentId: null, pitchOffset: 0, gain: 1, pan: 0 },
    ]
    const track = newTrack(drums.id, 4)
    // Set MIDI notes that map to the kick and snare.
    track.cells[0].note = 36 // kick
    track.cells[2].note = 38 // snare
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [drums.id]: drums }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    expect(data.slots).toHaveLength(1)

    const slot = data.slots[0]
    expect(slot.drumGateCount).toBe(2)

    // Kick gate channel 0 → fires at row 0.
    expect(slot.signals[0][0]).toBe(1)
    expect(slot.signals[0][2]).toBe(0) // no kick at row 2

    // Snare gate channel 1 → fires at row 2.
    expect(slot.signals[1][0]).toBe(0)
    expect(slot.signals[1][2]).toBe(1)

    // Vol channel is at drumSounds + DRUMKIT_CH.vol = 2 + 0 = 2.
    expect(slot.signals[2][0]).toBe(1) // default vol
  })

  it('effect lane defaults are applied to all slot channels', () => {
    const inst = newOscInstrument('Bass')
    const track = newTrack(inst.id, 4)
    setNote(track, 0, 60)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    const s = data.slots[0].signals

    // Portamento default: 0.5 (center = no pitch shift).
    expect(s[REGULAR_CH.portamento][0]).toBe(0.5)
    // VolumeSlide default: 1 (passthrough).
    expect(s[REGULAR_CH.volumeSlide][0]).toBe(1)
    // Panning default: 0.5 (center).
    expect(s[REGULAR_CH.panning][0]).toBe(0.5)
    // Vibrato/tremolo defaults: 0.
    expect(s[REGULAR_CH.vibratoRate][0]).toBe(0)
    expect(s[REGULAR_CH.vibratoDepth][0]).toBe(0)
    expect(s[REGULAR_CH.tremoloRate][0]).toBe(0)
    expect(s[REGULAR_CH.tremoloDepth][0]).toBe(0)
    // Staccato default: 1 (legato = FF).
    expect(s[REGULAR_CH.staccato][0]).toBe(1)
  })

  it('staccato value is populated from buildSequences', () => {
    const inst = newOscInstrument('Bass')
    const track = newTrack(inst.id, 4)
    setNote(track, 0, 60)
    setNote(track, 1, 64) // immediately after (gap=0) → auto-retrigger staccato
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])
    const s = data.slots[0].signals

    // Gap=0 without holds → staccato lowered for sub-row retrigger.
    expect(s[REGULAR_CH.staccato][0]).toBeLessThan(1)
  })

  it('totalRows equals sum of pattern lengths', () => {
    const inst = newOscInstrument('Bass')
    const t = newTrack(inst.id, 16)
    const p1: Pattern = { id: 'pat_1', name: 'P1', length: 16, trackIds: [t.id] }
    const p2: Pattern = { id: 'pat_2', name: 'P2', length: 32, trackIds: [t.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [t.id]: t }, { [p1.id]: p1, [p2.id]: p2 })

    const data = buildPlaybackData(doc, [
      { patternId: p1.id, startRow: 0 },
      { patternId: p2.id, startRow: 16 },
    ])
    expect(data.totalRows).toBe(48)
  })
})
