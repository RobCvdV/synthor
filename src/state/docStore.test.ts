import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from '../state/docStore'
import { createDefaultDoc } from '../domain/factory'
import type { Doc } from '../domain/types'

/** Reset the store to a known fresh state before each test. */
function resetStore(doc?: Doc) {
  useDocStore.getState().loadDoc(doc ?? createDefaultDoc())
}

describe('docStore — effect lanes', () => {
  beforeEach(() => resetStore())

  const firstTrackId = () => {
    const doc = useDocStore.getState().doc
    const pat = doc.entities.patterns[doc.patternId]
    return pat.trackIds[0]
  }

  it('adds an effect lane to a track', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')

    const track = useDocStore.getState().doc.entities.tracks[tid]
    expect(track.effectLanes).toHaveLength(1)
    expect(track.effectLanes[0].type).toBe('panning')
    expect(track.effectLanes[0].id).toMatch(/^lan_/)

    // Every cell should have the lane key with null value.
    for (const cell of track.cells) {
      expect(cell.effectLanes[track.effectLanes[0].id]).toBeNull()
    }
  })

  it('removes an effect lane and cleans up cells', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'panning')

    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id
    store.removeEffectLane(tid, laneId)

    const track = useDocStore.getState().doc.entities.tracks[tid]
    expect(track.effectLanes).toHaveLength(0)
    for (const cell of track.cells) {
      expect(cell.effectLanes[laneId]).toBeUndefined()
    }
  })

  it('sets and clears a lane value on a cell', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'vibratoDepth')
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id

    store.setCellEffectLane(tid, 0, laneId, 0.5)
    let cell = useDocStore.getState().doc.entities.tracks[tid].cells[0]
    expect(cell.effectLanes[laneId]).toBe(0.5)

    store.setCellEffectLane(tid, 0, laneId, null)
    cell = useDocStore.getState().doc.entities.tracks[tid].cells[0]
    expect(cell.effectLanes[laneId]).toBeNull()
  })

  it('changes lane type', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'panning')
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id

    store.setEffectLaneType(tid, laneId, 'vibratoDepth')
    const track = useDocStore.getState().doc.entities.tracks[tid]
    expect(track.effectLanes[0].type).toBe('vibratoDepth')
  })

  it('undo reverts lane add', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')
    expect(useDocStore.getState().doc.entities.tracks[tid].effectLanes).toHaveLength(1)

    useDocStore.getState().undo()
    expect(useDocStore.getState().doc.entities.tracks[tid].effectLanes).toHaveLength(0)
  })

  it('redo restores lane after undo', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')
    useDocStore.getState().undo()
    useDocStore.getState().redo()
    expect(useDocStore.getState().doc.entities.tracks[tid].effectLanes).toHaveLength(1)
  })

  it('default doc has no effect lanes on tracks', () => {
    const doc = useDocStore.getState().doc
    for (const track of Object.values(doc.entities.tracks)) {
      expect(track.effectLanes).toEqual([])
    }
  })

  it('default doc cells have empty effectLanes', () => {
    const doc = useDocStore.getState().doc
    for (const track of Object.values(doc.entities.tracks)) {
      for (const cell of track.cells) {
        expect(cell.effectLanes).toEqual({})
        // Old packed effect fields must not exist.
        expect((cell as any).effect).toBeUndefined()
        expect((cell as any).effectValue).toBeUndefined()
      }
    }
  })

  it('duplicateTrack copies effect lanes', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')
    // Re-read state after mutation — the old store reference is stale.
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id
    useDocStore.getState().setCellEffectLane(tid, 0, laneId, 0.75)

    useDocStore.getState().duplicateTrack(tid, 2)
    const doc = useDocStore.getState().doc
    const pat = doc.entities.patterns[doc.patternId]
    const newTid = pat.trackIds[2]
    const newTrack = doc.entities.tracks[newTid]
    expect(newTrack.effectLanes).toHaveLength(1)
    expect(newTrack.effectLanes[0].type).toBe('panning')
    expect(newTrack.cells[0].effectLanes[newTrack.effectLanes[0].id]).toBe(0.75)
  })
})
