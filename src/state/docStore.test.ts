import { beforeEach, describe, expect, it } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'

function firstTrackId(): string {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId].trackIds[0]
}

describe('docStore', () => {
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [] })
  })

  it('edits a cell note', () => {
    const trk = firstTrackId()
    useDocStore.getState().setCellNote(trk, 1, 62)
    expect(useDocStore.getState().doc.entities.tracks[trk].cells[1].note).toBe(62)
  })

  it('undoes and redoes an edit', () => {
    const trk = firstTrackId()
    const before = useDocStore.getState().doc.entities.tracks[trk].cells[1].note
    useDocStore.getState().setCellNote(trk, 1, 62)
    useDocStore.getState().undo()
    expect(useDocStore.getState().doc.entities.tracks[trk].cells[1].note).toBe(before)
    useDocStore.getState().redo()
    expect(useDocStore.getState().doc.entities.tracks[trk].cells[1].note).toBe(62)
  })

  it('does not record a no-op edit in history', () => {
    const trk = firstTrackId()
    const existing = useDocStore.getState().doc.entities.tracks[trk].cells[0].note
    useDocStore.getState().setCellNote(trk, 0, existing) // same value
    expect(useDocStore.getState().past).toHaveLength(0)
  })

  it('clears the redo stack on a fresh edit', () => {
    const trk = firstTrackId()
    useDocStore.getState().setCellNote(trk, 1, 62)
    useDocStore.getState().undo()
    expect(useDocStore.getState().future).toHaveLength(1)
    useDocStore.getState().setCellNote(trk, 2, 64)
    expect(useDocStore.getState().future).toHaveLength(0)
  })
})

function trackIds(): string[] {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId].trackIds
}

describe('docStore track operations', () => {
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [], trackClipboard: null })
  })

  it('inserts a new empty track at an index', () => {
    useDocStore.getState().addTrack(1)
    expect(trackIds()).toHaveLength(3)
    const newId = trackIds()[1]
    const cells = useDocStore.getState().doc.entities.tracks[newId].cells
    expect(cells.every((c) => c.note === null)).toBe(true)
  })

  it('removes a track and its now-orphaned instrument', () => {
    const [first] = trackIds()
    const instId = useDocStore.getState().doc.entities.tracks[first].instrumentId
    useDocStore.getState().removeTrack(first)
    expect(trackIds()).toHaveLength(1)
    expect(useDocStore.getState().doc.entities.tracks[first]).toBeUndefined()
    expect(useDocStore.getState().doc.entities.instruments[instId]).toBeUndefined()
  })

  it('moves a track', () => {
    const [a, b] = trackIds()
    useDocStore.getState().moveTrack(0, 1)
    expect(trackIds()).toEqual([b, a])
  })

  it('copies and pastes a track as an independent clone', () => {
    const [first] = trackIds()
    useDocStore.getState().setCellNote(first, 2, 99)
    useDocStore.getState().copyTrack(first)
    useDocStore.getState().pasteTrack(1)
    const pastedId = trackIds()[1]
    expect(pastedId).not.toBe(first)
    expect(useDocStore.getState().doc.entities.tracks[pastedId].cells[2].note).toBe(99)
    // Independent instrument.
    const srcInst = useDocStore.getState().doc.entities.tracks[first].instrumentId
    const dstInst = useDocStore.getState().doc.entities.tracks[pastedId].instrumentId
    expect(dstInst).not.toBe(srcInst)
  })

  it('duplicates a track', () => {
    const [first] = trackIds()
    useDocStore.getState().setCellNote(first, 0, 55)
    useDocStore.getState().duplicateTrack(first, 1)
    const dupId = trackIds()[1]
    expect(useDocStore.getState().doc.entities.tracks[dupId].cells[0].note).toBe(55)
  })

  it('undoes a track insert', () => {
    useDocStore.getState().addTrack(2)
    expect(trackIds()).toHaveLength(3)
    useDocStore.getState().undo()
    expect(trackIds()).toHaveLength(2)
  })
})
