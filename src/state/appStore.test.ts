import { describe, expect, it } from 'vitest'
import { useAppStore, PLAY_MODES, clampCursor, type TrackerCursor } from './appStore'
import type { Doc, Id, Pattern, Track } from '../domain/types'

/** Build a minimal Doc + Pattern pair for clampCursor tests. */
function makeFixture(args: {
  trackCount?: number
  effectLanesPerTrack?: number[]
  patternId?: Id
}): { doc: Doc; pattern: Pattern } {
  const tids: Id[] = []
  const tracks: Record<Id, Track> = {}
  const laneCounts = args.effectLanesPerTrack ?? Array(args.trackCount ?? 4).fill(0)
  for (let i = 0; i < laneCounts.length; i++) {
    const tid = `t${i}`
    tids.push(tid)
    const lanes: Array<{ id: Id; type: string }> = []
    for (let j = 0; j < laneCounts[i]; j++) {
      lanes.push({ id: `l-${i}-${j}`, type: 'panning' })
    }
    tracks[tid] = { id: tid, instrumentId: 'inst-a', cells: [], effectLanes: lanes }
  }
  const pid = args.patternId ?? 'p0'
  const pattern: Pattern = { id: pid, name: 'Pat', length: 64, trackIds: tids }
  const doc: Doc = {
    patternId: pid,
    sectionIds: [],
    entities: {
      instruments: {},
      tracks,
      patterns: { [pid]: pattern },
      sections: {},
      samples: {},
      mixChannels: {},
      mixerInstrumentOrder: [],
    },
  }
  return { doc, pattern }
}

/** Call before each test to reset the store to defaults. */
function resetStore() {
  useAppStore.setState({
    playMode: 'pattern',
    view: 'tracker',
    trackerCursor: { row: 0, track: 0, col: 0, laneIndex: null },
    selectedInstrumentId: null,
  })
}

describe('appStore', () => {
  beforeEach(resetStore)

  /* ---- play mode ---- */

  it('defaults to pattern mode', () => {
    expect(useAppStore.getState().playMode).toBe('pattern')
  })

  it('setPlayMode() switches to a different mode', () => {
    useAppStore.getState().setPlayMode('song')
    expect(useAppStore.getState().playMode).toBe('song')
    useAppStore.getState().setPlayMode('section')
    expect(useAppStore.getState().playMode).toBe('section')
  })

  it('cyclePlayMode() cycles through all three modes', () => {
    const store = useAppStore.getState()
    expect(store.playMode).toBe('pattern')
    store.cyclePlayMode()
    expect(useAppStore.getState().playMode).toBe('song')
    useAppStore.getState().cyclePlayMode()
    expect(useAppStore.getState().playMode).toBe('section')
    useAppStore.getState().cyclePlayMode()
    expect(useAppStore.getState().playMode).toBe('pattern') // wraps around
  })

  it('PLAY_MODES contains all three modes in order', () => {
    expect(PLAY_MODES).toEqual(['song', 'section', 'pattern'])
    expect(new Set(PLAY_MODES).size).toBe(3)
  })

  /* ---- view ---- */

  it('defaults to tracker view', () => {
    expect(useAppStore.getState().view).toBe('tracker')
  })

  it('setView() switches views', () => {
    useAppStore.getState().setView('instruments')
    expect(useAppStore.getState().view).toBe('instruments')
    useAppStore.getState().setView('samples')
    expect(useAppStore.getState().view).toBe('samples')
    useAppStore.getState().setView('tracker')
    expect(useAppStore.getState().view).toBe('tracker')
  })

  /* ---- tracker cursor ---- */

  it('defaults to row 0, track 0', () => {
    const c = useAppStore.getState().trackerCursor
    expect(c.row).toBe(0)
    expect(c.track).toBe(0)
    expect(c.col).toBe(0)
    expect(c.laneIndex).toBeNull()
  })

  it('setTrackerCursor() updates the cursor', () => {
    useAppStore.getState().setTrackerCursor({ row: 5, track: 2, col: 1, laneIndex: null })
    const c = useAppStore.getState().trackerCursor
    expect(c.row).toBe(5)
    expect(c.track).toBe(2)
    expect(c.col).toBe(1)
  })

  /* ---- selected instrument ---- */

  it('defaults to null instrument', () => {
    expect(useAppStore.getState().selectedInstrumentId).toBeNull()
  })

  it('setSelectedInstrumentId() updates the selected instrument', () => {
    useAppStore.getState().setSelectedInstrumentId('inst-123')
    expect(useAppStore.getState().selectedInstrumentId).toBe('inst-123')
    useAppStore.getState().setSelectedInstrumentId(null)
    expect(useAppStore.getState().selectedInstrumentId).toBeNull()
  })

  /* ---- cursor navigation scenarios ---- */

  it('laneIndex transitions between null and values correctly', () => {
    // Simulate entering an effect lane column.
    useAppStore.getState().setTrackerCursor({ row: 3, track: 0, col: 2, laneIndex: 0 })
    expect(useAppStore.getState().trackerCursor.laneIndex).toBe(0)
    // Leaving effect lanes back to volume column.
    useAppStore.getState().setTrackerCursor({ row: 3, track: 0, col: 1, laneIndex: null })
    expect(useAppStore.getState().trackerCursor.laneIndex).toBeNull()
  })

  it('wrapping track navigation resets cursor columns', () => {
    useAppStore.getState().setTrackerCursor({ row: 7, track: 0, col: 2, laneIndex: 1 })
    // Wrapping to next track resets to note column.
    useAppStore.getState().setTrackerCursor({ row: 7, track: 1, col: 0, laneIndex: null })
    const c = useAppStore.getState().trackerCursor
    expect(c.track).toBe(1)
    expect(c.col).toBe(0)
    expect(c.laneIndex).toBeNull()
  })

  /* ---- state shape: only the four persisted fields are user-settable ---- */

  it('has exactly the expected top-level state keys', () => {
    // Verify the store shape matches what we document. The persist middleware
    // partialize mirrors this — only these four keys ever hit localStorage.
    const s = useAppStore.getState()
    const keys = Object.keys(s).filter((k) =>
      ['playMode', 'view', 'trackerCursor', 'selectedInstrumentId'].includes(k),
    )
    expect(keys.sort()).toEqual([
      'playMode',
      'selectedInstrumentId',
      'trackerCursor',
      'view',
    ])
  })

  it('state fields are independent — changing one does not reset others', () => {
    useAppStore.getState().setPlayMode('song')
    useAppStore.getState().setView('samples')
    useAppStore.getState().setTrackerCursor({ row: 8, track: 1, col: 0, laneIndex: null })
    useAppStore.getState().setSelectedInstrumentId('abc')

    // Change one field — others stay intact.
    useAppStore.getState().setPlayMode('section')
    const s = useAppStore.getState()
    expect(s.playMode).toBe('section')
    expect(s.view).toBe('samples')
    expect(s.trackerCursor.row).toBe(8)
    expect(s.selectedInstrumentId).toBe('abc')
  })
})

describe('clampCursor', () => {
  /* ---- track bounds ---- */

  it('leaves a valid note-column cursor untouched', () => {
    const { doc, pattern } = makeFixture({ trackCount: 4 })
    const c: TrackerCursor = { row: 10, track: 2, col: 0, laneIndex: null }
    expect(clampCursor(c, pattern, doc)).toEqual(c)
  })

  it('leaves a valid volume-column cursor untouched', () => {
    const { doc, pattern } = makeFixture({ trackCount: 4 })
    const c: TrackerCursor = { row: 10, track: 2, col: 1, laneIndex: null }
    expect(clampCursor(c, pattern, doc)).toEqual(c)
  })

  it('leaves a valid effect-lane cursor untouched', () => {
    const { doc, pattern } = makeFixture({
      trackCount: 4,
      effectLanesPerTrack: [0, 3, 2, 0],
    })
    // Track 1 has 3 lanes (indices 0,1,2), cursor on lane 2 → col 4.
    const c: TrackerCursor = { row: 7, track: 1, col: 4, laneIndex: 2 }
    expect(clampCursor(c, pattern, doc)).toEqual(c)
  })

  it('clamps track index when it exceeds the pattern', () => {
    const { doc, pattern } = makeFixture({ trackCount: 3 })
    const c: TrackerCursor = { row: 10, track: 5, col: 0, laneIndex: null }
    expect(clampCursor(c, pattern, doc)).toEqual({
      row: 10,
      track: 2,
      col: 0,
      laneIndex: null,
    })
  })

  it('clamps track index but preserves column and laneIndex when track is out of bounds', () => {
    const { doc, pattern } = makeFixture({
      trackCount: 3,
      effectLanesPerTrack: [0, 2, 1],
    })
    const c: TrackerCursor = { row: 10, track: 7, col: 3, laneIndex: 1 }
    // Track 2 (last) has 1 lane (index 0) — laneIndex 1 gets clamped to 0.
    expect(clampCursor(c, pattern, doc)).toEqual({
      row: 10,
      track: 2,
      col: 2,
      laneIndex: 0,
    })
  })

  /* ---- effect lane bounds ---- */

  it('drops to volume column when cursor is on an effect lane but track has none', () => {
    const { doc, pattern } = makeFixture({
      trackCount: 4,
      effectLanesPerTrack: [0, 0, 0, 0],
    })
    // Track 2 has zero effect lanes but cursor claims laneIndex 2.
    const c: TrackerCursor = { row: 3, track: 2, col: 4, laneIndex: 2 }
    expect(clampCursor(c, pattern, doc)).toEqual({
      row: 3,
      track: 2,
      col: 1,
      laneIndex: null,
    })
  })

  it('clamps laneIndex to last available lane when it exceeds the track', () => {
    const { doc, pattern } = makeFixture({
      trackCount: 4,
      effectLanesPerTrack: [0, 1, 0, 0],
    })
    // Track 1 has 1 lane (index 0), but cursor claims laneIndex 3.
    const c: TrackerCursor = { row: 5, track: 1, col: 5, laneIndex: 3 }
    expect(clampCursor(c, pattern, doc)).toEqual({
      row: 5,
      track: 1,
      col: 2, // 2 + 0 (first and only lane)
      laneIndex: 0,
    })
  })

  it('corrects col to match laneIndex even when both are in bounds', () => {
    const { doc, pattern } = makeFixture({
      trackCount: 4,
      effectLanesPerTrack: [0, 5, 0, 0],
    })
    // Track 1 has 5 lanes (indices 0–4). laneIndex 2 is valid but col is
    // out of sync — it says 6 instead of 4.
    const c: TrackerCursor = { row: 1, track: 1, col: 6, laneIndex: 2 }
    expect(clampCursor(c, pattern, doc)).toEqual({
      row: 1,
      track: 1,
      col: 4, // 2 + 2
      laneIndex: 2,
    })
  })

  it('preserves row through all clamping', () => {
    const { doc, pattern } = makeFixture({ trackCount: 1 })
    const c: TrackerCursor = { row: 31, track: 5, col: 3, laneIndex: 1 }
    expect(clampCursor(c, pattern, doc).row).toBe(31)
  })

  /* ---- empty pattern edge case ---- */

  it('clamps to track 0 when pattern has no tracks', () => {
    const { doc, pattern } = makeFixture({ trackCount: 0 })
    const c: TrackerCursor = { row: 0, track: 0, col: 0, laneIndex: null }
    // track 0 >= 0 trackCount → enters the clamp branch
    expect(clampCursor(c, pattern, doc)).toEqual({
      row: 0,
      track: 0,
      col: 0,
      laneIndex: null,
    })
  })
})
