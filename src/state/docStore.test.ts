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
