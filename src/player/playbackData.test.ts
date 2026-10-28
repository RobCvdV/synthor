import { describe, expect, it } from 'vitest'
import { buildPlaybackData, slicePlaybackData } from '../player/playbackData'
import { newModularInstrument, newDrumKitInstrument, newTrack } from '../domain/factory'
import type { Doc, Id, Pattern, Track } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { DRUMKIT_CH, REGULAR_CH } from '../engine/voiceSlotLayout'

/** A plain modular synth with its seeded eff inlets removed — keeps the
 *  11-channel layout the old osc instrument had. */
function newSynth(name: string) {
  const inst = newModularInstrument(name)
  for (const m of Object.values(inst.modules)) {
    if (m.type === 'eff') delete inst.modules[m.id]
  }
  return inst
}

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
    tempo: { bpm: 120, linesPerBeat: 4 },
  }
}

/** Helper: set a MIDI note on a cell. */
function setNote(track: Track, row: number, note: number): void {
  track.cells[row].note = note
  track.cells[row].hold = false
}

describe('buildPlaybackData', () => {
  it('builds slot data for a single pattern with one instrument', () => {
    const inst = newSynth('Bass')
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

  it('ensureSlotInstId adds a silent slot for an instrument without tracks, in layout order', () => {
    const inst = newSynth('Bass')
    const idle = newSynth('Pad')
    const track = newTrack(inst.id, 4)
    setNote(track, 0, 60)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 4, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst, [idle.id]: idle }, { [track.id]: track }, { [pattern.id]: pattern })

    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }], idle.id)
    expect(data.slots.map((s) => s.instId)).toEqual([inst.id, idle.id].sort())
    const idleSlot = data.slots.find((s) => s.instId === idle.id)!
    expect(idleSlot.signals[REGULAR_CH.gate]).toEqual([0, 0, 0, 0])
  })

  it('builds slot data for two tracks using same instrument (2 slots)', () => {
    const inst = newSynth('Lead')
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

    // t1 note at row 0 → slot 0 gate[0] = 1.
    expect(s0.signals[REGULAR_CH.gate][0]).toBe(1)
    expect(s0.signals[REGULAR_CH.gate][2]).toBe(0)

    // t2 note at row 2 → slot 1 gate[2] = 1.
    expect(s1.signals[REGULAR_CH.gate][2]).toBe(1)
  })

  it('reuses slots across non-overlapping pattern windows', () => {
    const inst = newSynth('Bass')
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
    const inst = newSynth('Synth')
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
    const inst = newSynth('Synth')
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
      { id: 'dkick', note: 36, sampleId: null, instrumentId: null, baseNote: 36, volume: 1, pan: 0 },
      { id: 'dsnare', note: 38, sampleId: null, instrumentId: null, baseNote: 38, volume: 1, pan: 0 },
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

    // Vol channel is at 2*drumSounds + DRUMKIT_CH.vol = 4 + 0 = 4.
    expect(slot.signals[4][0]).toBe(1) // default vol
    // Freq channels are at indices 2 and 3 (drumSounds=2, gate+freq pairs).
    expect(slot.signals[2][0]).toBeCloseTo(65.41) // kick freq at row 0 (MIDI 36)
    expect(slot.signals[3][2]).toBeCloseTo(73.42) // snare freq at row 2 (MIDI 38)
  })

  it('effect lane defaults are applied to all slot channels', () => {
    const inst = newSynth('Bass')
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
    const inst = newSynth('Bass')
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
    const inst = newSynth('Bass')
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

describe('buildPlaybackData: notes held across the pattern start', () => {
  const synth = newSynth('Pad')
  /** A 4-row pattern: a note on row 2, optionally held on row 3, plus hold rows at the start. */
  const pattern = (id: string, opts: { holdEnd?: boolean; leadingHolds?: number; note?: number }) => {
    const track = newTrack(synth.id, 4)
    setNote(track, 2, opts.note ?? 60)
    if (opts.holdEnd) track.cells[3].hold = true
    for (let r = 0; r < (opts.leadingHolds ?? 0); r++) track.cells[r].hold = true
    return { track, pattern: { id, name: id, length: 4, trackIds: [track.id] } as Pattern }
  }
  const play = (...parts: ReturnType<typeof pattern>[]) => {
    const doc = makeDoc(
      { [synth.id]: synth },
      Object.fromEntries(parts.map((p) => [p.track.id, p.track])),
      Object.fromEntries(parts.map((p) => [p.pattern.id, p.pattern])),
    )
    const data = buildPlaybackData(doc, parts.map((p, i) => ({ patternId: p.pattern.id, startRow: i * 4 })))
    return data.slots[0].signals
  }

  it('releases a note held on the last row when the pattern starts without hold signs', () => {
    expect(play(pattern('a', { holdEnd: true }))[REGULAR_CH.gate]).toEqual([0, 0, 1, 1])
  })

  it('keeps it sounding through hold signs when the pattern loops', () => {
    const signals = play(pattern('a', { holdEnd: true, leadingHolds: 1 }))
    expect(signals[REGULAR_CH.gate]).toEqual([1, 0, 1, 1])
    expect(signals[REGULAR_CH.freq][0]).toBe(signals[REGULAR_CH.freq][3])
  })

  it('carries a held note into the next pattern only through its hold signs', () => {
    const signals = play(pattern('a', { holdEnd: true, note: 48 }), pattern('b', { leadingHolds: 2, note: 72 }))
    expect(signals[REGULAR_CH.gate]).toEqual([0, 0, 1, 1, 1, 1, 1, 0])
    // The held note keeps its pitch from pattern a.
    expect(signals[REGULAR_CH.freq][5]).toBe(signals[REGULAR_CH.freq][3])
  })

  it('leaves hold signs silent when the previous pattern released its note', () => {
    const signals = play(pattern('a', {}), pattern('b', { leadingHolds: 2, holdEnd: true }))
    expect(signals[REGULAR_CH.gate].slice(4)).toEqual([0, 0, 1, 1])
  })

  it('gives a note on the first row a gap to re-attack after a note held to the end', () => {
    const b = pattern('b', {})
    b.track.cells[0].note = 64
    const signals = play(pattern('a', { holdEnd: true }), b)
    expect(signals[REGULAR_CH.gate].slice(3, 5)).toEqual([1, 1])
    expect(signals[REGULAR_CH.staccato][3]).toBe(0.85)
    // A released note needs no gap.
    expect(play(pattern('c', {}), b)[REGULAR_CH.staccato][3]).toBe(1)
  })

  it('retriggers when a held pattern loops onto a note on its first row', () => {
    const a = pattern('a', { holdEnd: true })
    a.track.cells[0].note = 55
    expect(play(a)[REGULAR_CH.staccato][3]).toBe(0.85)
  })

  it('carries a drum kit sound held into the next pattern', () => {
    const drums = newDrumKitInstrument('Drums')
    drums.slots = [
      { id: 'dkick', note: 36, sampleId: null, instrumentId: null, baseNote: 36, volume: 1, pan: 0 },
      { id: 'dsnare', note: 38, sampleId: null, instrumentId: null, baseNote: 38, volume: 1, pan: 0 },
    ]
    const a = newTrack(drums.id, 4)
    a.cells[3].note = 38
    const b = newTrack(drums.id, 4)
    b.cells[0].hold = true
    b.cells[2].note = 36
    const doc = makeDoc(
      { [drums.id]: drums },
      { [a.id]: a, [b.id]: b },
      { a: { id: 'a', name: 'a', length: 4, trackIds: [a.id] }, b: { id: 'b', name: 'b', length: 4, trackIds: [b.id] } },
    )
    const { signals } = buildPlaybackData(doc, [{ patternId: 'a', startRow: 0 }, { patternId: 'b', startRow: 4 }]).slots[0]
    expect(signals[1]).toEqual([0, 0, 0, 1, 1, 0, 0, 0]) // snare
    expect(signals[0]).toEqual([0, 0, 0, 0, 0, 0, 1, 0]) // kick

    // A snare hit on b's first row instead re-attacks: the shared staccato channel cuts row 3.
    b.cells[0] = { ...b.cells[0], hold: false, note: 38 }
    const again = buildPlaybackData(doc, [{ patternId: 'a', startRow: 0 }, { patternId: 'b', startRow: 4 }]).slots[0]
    expect(again.signals[1].slice(3, 5)).toEqual([1, 1])
    expect(again.signals[2 * 2 + DRUMKIT_CH.staccato][3]).toBe(0.85)
  })
})

describe('slicePlaybackData', () => {
  it('keeps rows start..end of every channel and records the offset', () => {
    const inst = newSynth('Bass')
    const track = newTrack(inst.id, 8)
    setNote(track, 4, 60)
    const pattern: Pattern = { id: 'pat_1', name: 'P1', length: 8, trackIds: [track.id] }
    const doc = makeDoc({ [inst.id]: inst }, { [track.id]: track }, { [pattern.id]: pattern })
    const data = buildPlaybackData(doc, [{ patternId: pattern.id, startRow: 0 }])

    const loop = slicePlaybackData(data, 4, 6)!
    expect(loop.totalRows).toBe(3)
    expect(loop.rowOffset).toBe(4)
    expect(loop.slots[0].signals[REGULAR_CH.gate]).toEqual([1, 0, 0])
    expect(loop.slots[0].signals.every((sig) => sig.length === 3)).toBe(true)
  })

  it('rejects a range outside the data', () => {
    const data = { slots: [], totalRows: 8, arrangement: [] }
    expect(slicePlaybackData(data, 4, 8)).toBeNull()
    expect(slicePlaybackData(data, -1, 2)).toBeNull()
    expect(slicePlaybackData(data, 5, 4)).toBeNull()
  })
})
