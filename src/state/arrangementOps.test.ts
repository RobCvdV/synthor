import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc
const pattern = () => doc().entities.patterns[doc().patternId]

describe('arrangementOps', () => {
  beforeEach(() => resetStore())

  it('setPatternLength resizes every track in the pattern', () => {
    const store = useDocStore.getState()
    const pid = doc().patternId
    store.setPatternLength(pid, 16)
    expect(pattern().length).toBe(16)
    for (const tid of pattern().trackIds) {
      expect(doc().entities.tracks[tid].cells).toHaveLength(16)
    }
  })

  it('setPatternLength rejects out-of-range lengths', () => {
    const store = useDocStore.getState()
    const pid = doc().patternId
    const pastBefore = store.past.length
    store.setPatternLength(pid, 0)
    store.setPatternLength(pid, 257)
    expect(store.past.length).toBe(pastBefore)
    expect(pattern().length).toBe(32)
  })

  it('setCurrentPattern switches only to existing patterns', () => {
    const store = useDocStore.getState()
    const current = doc().patternId
    const newId = store.addPattern('P2')
    expect(doc().patternId).toBe(newId)
    store.setCurrentPattern(current)
    expect(doc().patternId).toBe(current)

    const pastBefore = store.past.length
    store.setCurrentPattern('nope')
    expect(store.past.length).toBe(pastBefore)
    expect(doc().patternId).toBe(current)
  })

  it('reorderSections guards out-of-range moves', () => {
    const store = useDocStore.getState()
    store.addSection('S2')
    const idsBefore = [...doc().sectionIds]
    const pastBefore = store.past.length
    store.reorderSections(-1, 0)
    store.reorderSections(0, 99)
    expect(store.past.length).toBe(pastBefore)
    expect(doc().sectionIds).toEqual(idsBefore)
  })

  it('reorderPatternsInSection guards out-of-range moves', () => {
    const store = useDocStore.getState()
    const p2 = store.addPattern('P2')
    const sec = doc().sectionIds[0]
    store.addPatternToSection(sec, p2)
    const idsBefore = [...doc().entities.sections[sec].patternIds]
    const pastBefore = store.past.length
    store.reorderPatternsInSection(sec, -1, 0)
    store.reorderPatternsInSection(sec, 0, 99)
    expect(store.past.length).toBe(pastBefore)
    expect(doc().entities.sections[sec].patternIds).toEqual(idsBefore)
  })
})

describe('arrangementOps — make unique / pattern from rows', () => {
  beforeEach(() => resetStore())

  it('makeStepUnique swaps one step to a deep copy and shows it, as one undo step', () => {
    const store = useDocStore.getState()
    const sid = doc().sectionIds[0]
    const orig = doc().patternId
    store.addPatternToSection(sid, orig)
    const tid = pattern().trackIds[0]
    store.setCellNote(tid, 0, 60)

    const copy = useDocStore.getState().makeStepUnique(sid, 1)!
    expect(doc().entities.sections[sid].patternIds).toEqual([orig, copy])
    expect(doc().patternId).toBe(copy)
    const copyTrack = doc().entities.tracks[doc().entities.patterns[copy].trackIds[0]]
    expect(copyTrack.id).not.toBe(tid)
    expect(copyTrack.cells[0].note).toBe(60)

    useDocStore.getState().setCellNote(copyTrack.id, 0, 72)
    expect(doc().entities.tracks[tid].cells[0].note).toBe(60)

    useDocStore.getState().undo()
    useDocStore.getState().undo()
    expect(doc().entities.sections[sid].patternIds).toEqual([orig, orig])
  })

  it('makeStepUnique ignores a missing step', () => {
    expect(useDocStore.getState().makeStepUnique(doc().sectionIds[0], 9)).toBeNull()
  })

  it('patternFromRows makes a current pattern of the selected rows and tracks', () => {
    const store = useDocStore.getState()
    const [t0] = pattern().trackIds
    store.setCellNote(t0, 4, 64)
    store.addEffectLane(t0, 'panning')

    const id = useDocStore.getState().patternFromRows([t0], 4, 7)!
    const p = doc().entities.patterns[id]
    expect(doc().patternId).toBe(id)
    expect(p.length).toBe(4)
    expect(p.trackIds).toHaveLength(1)
    const track = doc().entities.tracks[p.trackIds[0]]
    expect(track.cells.map((c) => c.note)).toEqual([64, null, null, null])
    expect(track.effectLanes.map((l) => l.type)).toEqual(['panning'])
  })

  it('patternFromRows rejects unknown tracks', () => {
    expect(useDocStore.getState().patternFromRows(['nope'], 0, 3)).toBeNull()
  })
})
