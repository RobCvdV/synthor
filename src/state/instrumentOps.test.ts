import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'
import type { ModularInstrument } from '../domain/types'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc
const firstTrackId = () => doc().entities.patterns[doc().patternId].trackIds[0]
const firstInstId = () => doc().entities.tracks[firstTrackId()].instrumentId

describe('instrumentOps', () => {
  beforeEach(() => resetStore())

  it('addInstrument returns the id and appends to the mixer order', () => {
    const store = useDocStore.getState()
    const orderBefore = doc().entities.mixerInstrumentOrder.length
    const id = store.addInstrument('modular')
    expect(doc().entities.instruments[id]).toBeDefined()
    expect(doc().entities.mixerInstrumentOrder).toHaveLength(orderBefore + 1)
  })

  it('removeInstrument refuses instruments still in use', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()
    const pastBefore = store.past.length
    store.removeInstrument(instId)
    expect(store.past.length).toBe(pastBefore)
    expect(doc().entities.instruments[instId]).toBeDefined()
  })

  it('removeInstrument removes unused instruments from the mixer order', () => {
    const store = useDocStore.getState()
    const id = store.addInstrument('drumkit')
    store.removeInstrument(id)
    expect(doc().entities.instruments[id]).toBeUndefined()
    expect(doc().entities.mixerInstrumentOrder).not.toContain(id)
  })

  it('renameInstrument updates the name', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()
    store.renameInstrument(instId, 'Renamed')
    expect(doc().entities.instruments[instId].name).toBe('Renamed')
  })

  it('setTrackInstrument swaps the track instrument and guards unknown targets', () => {
    const store = useDocStore.getState()
    const tid = firstTrackId()
    const other = store.addInstrument('modular')
    store.setTrackInstrument(tid, other)
    expect(doc().entities.tracks[tid].instrumentId).toBe(other)

    const pastBefore = store.past.length
    store.setTrackInstrument(tid, 'nope')
    expect(store.past.length).toBe(pastBefore)
    expect(doc().entities.tracks[tid].instrumentId).toBe(other)
  })

  it('setEffectSetting only applies to modular instruments', () => {
    const store = useDocStore.getState()
    const kitId = store.addInstrument('drumkit')
    const pastBefore = store.past.length
    store.setEffectSetting(kitId, 'delayTimeMax', 2)
    expect(store.past.length).toBe(pastBefore)

    const modId = store.addInstrument('modular')
    store.setEffectSetting(modId, 'delayTimeMax', 2)
    expect((doc().entities.instruments[modId] as ModularInstrument).effectSettings!.delayTimeMax).toBe(2)
  })

  it('duplicateInstrument clones with fresh ids and inserts after the original', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()
    const cloneId = store.duplicateInstrument(instId)
    expect(cloneId).not.toBe('')
    expect(cloneId).not.toBe(instId)

    const clone = doc().entities.instruments[cloneId] as ModularInstrument
    const original = doc().entities.instruments[instId] as ModularInstrument
    expect(clone.name).toBe(`${original.name} (copy)`)
    expect(Object.keys(clone.modules)).not.toEqual(Object.keys(original.modules))

    const order = doc().entities.mixerInstrumentOrder
    expect(order[order.indexOf(instId) + 1]).toBe(cloneId)
  })

  it('duplicateInstrument returns empty string for unknown ids', () => {
    expect(useDocStore.getState().duplicateInstrument('nope')).toBe('')
  })
})
