import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc, newSampleEntity } from '../domain/factory'
import type { DrumKitInstrument } from '../domain/types'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc

const addSample = (name = 'Kick') => {
  const sample = newSampleEntity(name, 'hash1', `${name}.wav`, 44100, 1, 100)
  useDocStore.getState().addSampleEntity(sample)
  return sample
}

describe('sampleOps', () => {
  beforeEach(() => resetStore())

  it('addSampleEntity adds the sample to the doc', () => {
    const sample = addSample()
    expect(doc().entities.samples[sample.id]).toBeDefined()
  })

  it('removeSampleEntity deletes the sample', () => {
    const sample = addSample()
    useDocStore.getState().removeSampleEntity(sample.id)
    expect(doc().entities.samples[sample.id]).toBeUndefined()
  })

  it('removeSampleEntity is blocked while a drumkit slot references it', () => {
    const sample = addSample()
    const kitId = useDocStore.getState().addInstrument('drumkit')
    useDocStore.getState().addDrumKitSlot(kitId, 40, sample.id)

    useDocStore.getState().removeSampleEntity(sample.id)
    expect(doc().entities.samples[sample.id]).toBeDefined()

    // After clearing the slot's source it can be removed.
    const kit = doc().entities.instruments[kitId] as DrumKitInstrument
    useDocStore.getState().setDrumKitSlotSource(kitId, kit.slots[0].id, null, null)
    useDocStore.getState().removeSampleEntity(sample.id)
    expect(doc().entities.samples[sample.id]).toBeUndefined()
  })

  it('removeSampleEntity on an unknown id is a no-op without history', () => {
    const store = useDocStore.getState()
    const pastBefore = store.past.length
    store.removeSampleEntity('nope')
    expect(store.past.length).toBe(pastBefore)
  })

  it('renameSample trims whitespace', () => {
    const sample = addSample()
    useDocStore.getState().renameSample(sample.id, '  Snare  ')
    expect(doc().entities.samples[sample.id].name).toBe('Snare')
  })

  it('replaceSampleAsset rewrites the asset fields', () => {
    const sample = addSample()
    useDocStore.getState().replaceSampleAsset(sample.id, 'hash2', 'new.wav', 48000, 2, 200)
    const fresh = doc().entities.samples[sample.id]
    expect(fresh.hash).toBe('hash2')
    expect(fresh.originalName).toBe('new.wav')
    expect(fresh.sampleRate).toBe(48000)
    expect(fresh.channels).toBe(2)
    expect(fresh.frames).toBe(200)
  })
})
