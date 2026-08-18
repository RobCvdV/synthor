import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc, newSampleEntity } from '../domain/factory'
import { setActiveParamRefs, type ParamRefRegistry } from '../audio/paramRefs'
import type { DrumKitInstrument } from '../domain/types'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc

function setupKit(): DrumKitInstrument {
  const id = useDocStore.getState().addInstrument('drumkit')
  return doc().entities.instruments[id] as DrumKitInstrument
}

function setupSample(): string {
  const sample = newSampleEntity('Kick', 'hash1', 'kick.wav', 44100, 1, 100)
  useDocStore.getState().addSampleEntity(sample)
  return sample.id
}

describe('drumkitOps', () => {
  beforeEach(() => resetStore())

  it('addDrumKitSlot requires a source and inserts sorted by note', () => {
    const kit = setupKit()
    const store = useDocStore.getState()
    const pastBefore = store.past.length
    store.addDrumKitSlot(kit.id, 40) // no source → no-op
    expect(store.past.length).toBe(pastBefore)

    const sampleId = setupSample()
    store.addDrumKitSlot(kit.id, 50, sampleId)
    store.addDrumKitSlot(kit.id, 40, sampleId)
    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    expect(fresh.slots.map((s) => s.note)).toEqual([40, 50])
    expect(fresh.slots[0].sampleId).toBe(sampleId)
  })

  it('removeDrumKitSlot removes only the given slot', () => {
    const kit = setupKit()
    const sampleId = setupSample()
    const store = useDocStore.getState()
    store.addDrumKitSlot(kit.id, 40, sampleId)
    store.addDrumKitSlot(kit.id, 50, sampleId)
    const slotId = (doc().entities.instruments[kit.id] as DrumKitInstrument).slots[0].id
    store.removeDrumKitSlot(kit.id, slotId)
    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    expect(fresh.slots).toHaveLength(1)
    expect(fresh.slots[0].note).toBe(50)
  })

  it('setOrPromoteSlotParam promotes an inherited slot in one undo step', () => {
    const kit = setupKit()
    const sampleId = setupSample()
    const store = useDocStore.getState()
    store.addDrumKitSlot(kit.id, 40, sampleId)

    const pastBefore = useDocStore.getState().past.length
    store.setOrPromoteSlotParam(kit.id, 45, 'volume', 0.5)
    expect(useDocStore.getState().past.length).toBe(pastBefore + 1) // one undo step

    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    const promoted = fresh.slots.find((s) => s.note === 45)
    expect(promoted).toBeDefined()
    expect(promoted!.sampleId).toBe(sampleId) // source copied from parent
    expect(promoted!.volume).toBe(0.5)
    expect(fresh.slots.find((s) => s.note === 40)!.volume).toBe(1) // parent untouched
  })

  it('setOrPromoteSlotParam edits an explicit slot directly', () => {
    const kit = setupKit()
    const sampleId = setupSample()
    const store = useDocStore.getState()
    store.addDrumKitSlot(kit.id, 40, sampleId)
    store.setOrPromoteSlotParam(kit.id, 40, 'pan', -0.25)
    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    expect(fresh.slots.find((s) => s.note === 40)!.pan).toBe(-0.25)
    expect(fresh.slots).toHaveLength(1) // no new slot created
  })

  it('setDrumKitSlotSource swaps both source fields', () => {
    const kit = setupKit()
    const sampleId = setupSample()
    const store = useDocStore.getState()
    store.addDrumKitSlot(kit.id, 40, sampleId)
    const slotId = (doc().entities.instruments[kit.id] as DrumKitInstrument).slots[0].id
    store.setDrumKitSlotSource(kit.id, slotId, null, 'some-inst')
    const fresh = (doc().entities.instruments[kit.id] as DrumKitInstrument).slots[0]
    expect(fresh.sampleId).toBeNull()
    expect(fresh.instrumentId).toBe('some-inst')
  })

  it('setDrumKitParam persists and updates the param ref', () => {
    const setValue = vi.fn()
    setActiveParamRefs({ setValue } as unknown as ParamRefRegistry)
    const kit = setupKit()
    useDocStore.getState().setDrumKitParam(kit.id, 'gain', 0.7)
    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    expect(fresh.params.gain).toBe(0.7)
    expect(setValue).toHaveBeenCalledWith(`${kit.id}:gain`, 0.7)
  })

  it('setDrumKitKeyRange clamps to 0-127', () => {
    const kit = setupKit()
    useDocStore.getState().setDrumKitKeyRange(kit.id, -5, 200)
    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    expect(fresh.keyLo).toBe(0)
    expect(fresh.keyHi).toBe(127)
  })

  it('setDrumKitParamSilent persists with silentBatch and updates the ref', () => {
    const setValue = vi.fn()
    setActiveParamRefs({ setValue } as unknown as ParamRefRegistry)
    const kit = setupKit()
    const seen: boolean[] = []
    const unsub = useDocStore.subscribe((s) => seen.push(s.silentBatch))

    useDocStore.getState().setDrumKitParamSilent(kit.id, 'gain', 0.4)
    unsub()

    const fresh = doc().entities.instruments[kit.id] as DrumKitInstrument
    expect(fresh.params.gain).toBe(0.4)
    expect(setValue).toHaveBeenCalledWith(`${kit.id}:gain`, 0.4)
    expect(seen).toContain(true)
    expect(seen[seen.length - 1]).toBe(false)
  })

  afterEach(() => {
    setActiveParamRefs(null)
  })
})
