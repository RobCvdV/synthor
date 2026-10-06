import { describe, expect, it } from 'vitest'
import { createChannelEffect, createDefaultDoc, newDrumKitInstrument, newSampleEntity } from '../domain/factory'
import { auditionKey, sampleInUse, withAudition } from './audition'
import { buildSampleMeta } from './compile'

describe('withAudition', () => {
  const doc = createDefaultDoc()
  const sample = newSampleEntity('kick', 'h1', 'kick.wav', 44100, 1, 100)
  doc.entities.samples[sample.id] = sample

  it('points the sample at its tuned audio without touching the stored doc', () => {
    const key = auditionKey(sample.id, 3)
    const out = withAudition(doc, { sampleId: sample.id, key, frames: 50, channels: 2 })
    expect(out.entities.samples[sample.id]).toMatchObject({ hash: key, frames: 50, channels: 2, name: 'kick' })
    expect(doc.entities.samples[sample.id].hash).toBe('h1')
    expect(buildSampleMeta(out.entities.samples, new Set([key]))[sample.id].hash).toBe(key)
  })

  it('is the doc itself without an audition, or for a deleted sample', () => {
    expect(withAudition(doc, null)).toBe(doc)
    expect(withAudition(doc, { sampleId: 'gone', key: 'k', frames: 1, channels: 1 })).toBe(doc)
  })
})

describe('sampleInUse', () => {
  it('finds the sample in drum kit slots and mixer effects', () => {
    const doc = createDefaultDoc()
    expect(sampleInUse(doc, 's1')).toBe(false)
    const kit = newDrumKitInstrument('kit')
    kit.slots.push({ id: 'slot1', note: 36, baseNote: 36, sampleId: 's1', instrumentId: null, volume: 1, pan: 0 })
    doc.entities.instruments[kit.id] = kit
    expect(sampleInUse(doc, 's1')).toBe(true)
    const conv = { ...createChannelEffect('conv'), sampleId: 's2' }
    Object.values(doc.entities.mixChannels)[0].effects.push(conv)
    expect(sampleInUse(doc, 's2')).toBe(true)
  })
})
