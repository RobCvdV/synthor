import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc
const pattern = () => doc().entities.patterns[doc().patternId]
const trackIds = () => pattern().trackIds
const firstTrackId = () => trackIds()[0]
const firstInstId = () => doc().entities.tracks[firstTrackId()].instrumentId

describe('trackOps — track operations', () => {
  beforeEach(() => resetStore())

  it('addTrack appends a track for an existing instrument', () => {
    const store = useDocStore.getState()
    const before = trackIds().length
    store.addTrack(before, firstInstId())
    expect(trackIds()).toHaveLength(before + 1)
    expect(doc().entities.tracks[trackIds()[before]].instrumentId).toBe(firstInstId())
  })

  it('addTrack with an unknown instrument is a no-op', () => {
    const store = useDocStore.getState()
    const before = trackIds().length
    store.addTrack(before, 'nope')
    expect(trackIds()).toHaveLength(before)
  })

  it('removeTrack removes the track but keeps its instrument', () => {
    const store = useDocStore.getState()
    const tid = firstTrackId()
    const instId = doc().entities.tracks[tid].instrumentId
    const before = trackIds().length
    store.removeTrack(tid)
    expect(trackIds()).toHaveLength(before - 1)
    expect(doc().entities.tracks[tid]).toBeUndefined()
    expect(doc().entities.instruments[instId]).toBeDefined()
  })

  it('moveTrack swaps positions and guards out-of-range moves', () => {
    const store = useDocStore.getState()
    store.addTrack(1, firstInstId())
    const [a, b] = trackIds()
    store.moveTrack(0, 1)
    expect(trackIds()[1]).toBe(a)
    expect(trackIds()[0]).toBe(b)
    const pastBefore = store.past.length
    store.moveTrack(-1, 0)
    store.moveTrack(0, 99)
    expect(store.past.length).toBe(pastBefore)
  })

  it('copyTrack is non-undoable scratch; pasteTrack clones with fresh ids', () => {
    const store = useDocStore.getState()
    const tid = firstTrackId()
    const instId = doc().entities.tracks[tid].instrumentId
    const pastBefore = store.past.length
    store.copyTrack(tid)
    expect(store.past.length).toBe(pastBefore) // clipboard ops are not undoable

    const before = trackIds().length
    store.pasteTrack(before)
    expect(trackIds()).toHaveLength(before + 1)
    const pasted = doc().entities.tracks[trackIds()[before]]
    expect(pasted.instrumentId).not.toBe(instId) // pasted instrument is a clone
    expect(pasted.instrumentId).toMatch(/^inst_/)
    expect(pasted.cells).toHaveLength(pattern().length)
  })

  it('duplicateTrack shares the same instrument', () => {
    const store = useDocStore.getState()
    const tid = firstTrackId()
    const instId = doc().entities.tracks[tid].instrumentId
    const before = trackIds().length
    store.duplicateTrack(tid, before)
    const dup = doc().entities.tracks[trackIds()[before]]
    expect(dup.instrumentId).toBe(instId)
    expect(dup.cells).toHaveLength(pattern().length)
  })

  it('shiftTrack rotates cells in both directions', () => {
    const store = useDocStore.getState()
    const tid = firstTrackId()
    store.setCellNote(tid, 0, 60)
    const first = doc().entities.tracks[tid].cells[0]
    const lastBefore = doc().entities.tracks[tid].cells[pattern().length - 1]

    store.shiftTrack(tid, 'up')
    expect(doc().entities.tracks[tid].cells[pattern().length - 1].note).toBe(60)
    expect(doc().entities.tracks[tid].cells[0]).not.toBe(first)

    store.shiftTrack(tid, 'down')
    expect(doc().entities.tracks[tid].cells[0].note).toBe(60)
    expect(doc().entities.tracks[tid].cells[pattern().length - 1]).toBe(lastBefore)
  })
})

describe('trackOps — rectangular clipboard', () => {
  beforeEach(() => resetStore())

  it('copyRect and cutRect are non-undoable; cutRect clears the cells', () => {
    useDocStore.getState().setCellNote(firstTrackId(), 0, 60)
    useDocStore.getState().setCellNote(firstTrackId(), 1, 62)
    const ids = trackIds()
    const pastBefore = useDocStore.getState().past.length

    useDocStore.getState().copyRect(ids, 0, 1, 0, 0)
    expect(useDocStore.getState().past.length).toBe(pastBefore)
    expect(useDocStore.getState().rectClipboard?.cells).toHaveLength(1)
    expect(useDocStore.getState().rectClipboard?.cells[0]).toHaveLength(2)

    useDocStore.getState().cutRect(ids, 0, 1, 0, 0)
    expect(doc().entities.tracks[ids[0]].cells[0].note).toBeNull()
    expect(doc().entities.tracks[ids[0]].cells[1].note).toBeNull()
  })

  it('pasteRect writes cells at the target position and is undoable', () => {
    const store = useDocStore.getState()
    const ids = trackIds()
    store.setCellNote(ids[0], 0, 60)
    store.setCellNote(ids[0], 1, 62)
    store.copyRect(ids, 0, 1, 0, 0)
    store.cutRect(ids, 0, 1, 0, 0)

    store.pasteRect(ids, 4, 0)
    expect(doc().entities.tracks[ids[0]].cells[4].note).toBe(60)
    expect(doc().entities.tracks[ids[0]].cells[5].note).toBe(62)
  })

  it('pasteRect auto-creates missing effect lanes on the target track', () => {
    const store = useDocStore.getState()
    store.addTrack(1, firstInstId())
    const [srcId, target] = trackIds()
    store.addEffectLane(srcId, 'panning')
    const lane = doc().entities.tracks[srcId].effectLanes[0]
    store.setCellEffectLane(srcId, 0, lane.id, 0.5)
    store.copyRect([srcId], 0, 0, 0, 0)

    expect(doc().entities.tracks[target].effectLanes).toHaveLength(0)
    store.pasteRect([target], 0, 0)
    const pastedTrack = doc().entities.tracks[target]
    expect(pastedTrack.effectLanes.map((l) => l.id)).toContain(lane.id)
    expect(pastedTrack.cells[0].effectLanes[lane.id]).toBe(0.5)
  })

  it('pasteRect bounds-check: out-of-range rows and tracks are skipped', () => {
    const store = useDocStore.getState()
    const ids = trackIds()
    store.setCellNote(ids[0], 0, 60)
    store.copyRect(ids, 0, 0, 0, 0)
    const pastBefore = store.past.length

    store.pasteRect(ids, -5, 0)
    store.pasteRect(ids, 0, 99)
    // Negative row lands partly out of range; expect no crash and no new tracks.
    expect(trackIds().length).toBe(ids.length)
    expect(store.past.length).toBeGreaterThanOrEqual(pastBefore)
  })
})
