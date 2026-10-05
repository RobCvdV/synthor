import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const firstTrackId = () => {
  const doc = useDocStore.getState().doc
  return doc.entities.patterns[doc.patternId].trackIds[0]
}

describe('trackerOps — cell editing', () => {
  beforeEach(() => resetStore())

  it('setCellNote sets the note and clears hold and note-off', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.setCellHold(tid, 0, true)
    store.setCellNote(tid, 0, 60)

    const cell = useDocStore.getState().doc.entities.tracks[tid].cells[0]
    expect(cell.note).toBe(60)
    expect(cell.hold).toBe(false)
    expect(cell.noteOff).toBe(false)
  })

  it('setCellHold sets hold and clears the note', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.setCellNote(tid, 0, 60)
    store.setCellHold(tid, 0, true)

    const cell = useDocStore.getState().doc.entities.tracks[tid].cells[0]
    expect(cell.hold).toBe(true)
    expect(cell.note).toBeNull()
  })

  it('setCellVolume stores numbers and null', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.setCellVolume(tid, 0, 0.5)
    expect(useDocStore.getState().doc.entities.tracks[tid].cells[0].volume).toBe(0.5)
    store.setCellVolume(tid, 0, null)
    expect(useDocStore.getState().doc.entities.tracks[tid].cells[0].volume).toBeNull()
  })

  it('setCellEffectLane writes and clears a lane value', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'panning')
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id

    store.setCellEffectLane(tid, 0, laneId, 0.25)
    expect(useDocStore.getState().doc.entities.tracks[tid].cells[0].effectLanes[laneId]).toBe(0.25)

    store.setCellEffectLane(tid, 0, laneId, null)
    expect(useDocStore.getState().doc.entities.tracks[tid].cells[0].effectLanes[laneId]).toBeNull()
  })

  it('cell edits are undoable and redoable', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.setCellNote(tid, 0, 60)
    store.setCellNote(tid, 0, 64)

    store.undo()
    expect(useDocStore.getState().doc.entities.tracks[tid].cells[0].note).toBe(60)
    store.redo()
    expect(useDocStore.getState().doc.entities.tracks[tid].cells[0].note).toBe(64)
  })

  it('edits to unknown tracks or rows are no-ops without history', () => {
    const store = useDocStore.getState()
    const pastBefore = store.past.length
    store.setCellNote('nope', 0, 60)
    store.setCellNote(firstTrackId(), 999, 60)
    expect(store.past.length).toBe(pastBefore)
  })
  it('interpolateColumn fills only the volume column, as one undo step', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.setCellNote(tid, 1, 60)
    store.interpolateColumn(tid, 0, 3, null, 0, 1)

    const cells = () => useDocStore.getState().doc.entities.tracks[tid].cells
    expect(cells().slice(0, 4).map((c) => Math.round(c.volume! * 255))).toEqual([0, 85, 170, 255])
    expect(cells()[4].volume).toBeNull()
    expect(cells()[1].note).toBe(60)

    useDocStore.getState().undo()
    expect(cells().slice(0, 4).every((c) => c.volume === null)).toBe(true)
  })

  it('interpolateColumn fills only the given effect lane', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'panning')
    store.addEffectLane(tid, 'staccato')
    const [pan, stac] = useDocStore.getState().doc.entities.tracks[tid].effectLanes.map((l) => l.id)
    store.interpolateColumn(tid, 2, 4, pan, 1, 0)

    const cells = useDocStore.getState().doc.entities.tracks[tid].cells
    expect(cells.slice(2, 5).map((c) => Math.round(c.effectLanes[pan]! * 255))).toEqual([255, 128, 0])
    expect(cells[1].effectLanes[pan]).toBeNull()
    expect(cells.slice(2, 5).every((c) => c.effectLanes[stac] === null && c.volume === null)).toBe(true)
  })

  it('interpolateColumn ignores an unknown lane', () => {
    const tid = firstTrackId()
    const before = useDocStore.getState().doc
    useDocStore.getState().interpolateColumn(tid, 0, 3, 'nope', 0, 1)
    expect(useDocStore.getState().doc).toBe(before)
  })
})
