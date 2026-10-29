import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultDoc } from '../domain/factory'
import { useDocStore } from './docStore'

const doc = () => useDocStore.getState().doc

describe('gameOps', () => {
  beforeEach(() => useDocStore.getState().loadDoc(createDefaultDoc()))

  it('gives a song game settings to start from, once, and takes them away', () => {
    const store = useDocStore.getState()
    store.editGame((g) => { g.bar = 8 }) // nothing to edit yet
    expect(doc().game).toBeUndefined()
    store.createGame()
    const section = doc().entities.sections[doc().sectionIds[0]]
    expect(doc().game?.song.sections.map((s) => s.cue)).toEqual([section.name])
    store.editGame((g) => { g.bar = 8 })
    store.createGame() // keeps what's there
    expect(doc().game?.bar).toBe(8)
    store.removeGame()
    expect(doc().game).toBeUndefined()
  })

  it('makes every edit one undo step', () => {
    const store = useDocStore.getState()
    store.createGame()
    store.editGame((g) => { g.song.sections[0].energy = 5 })
    expect(doc().game?.song.sections[0].energy).toBe(5)
    useDocStore.getState().undo()
    expect(doc().game?.song.sections[0].energy).toBe(3)
    useDocStore.getState().undo()
    expect(doc().game).toBeUndefined()
  })
})
