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
})
