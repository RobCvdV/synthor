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
