import { describe, expect, it } from 'vitest'
import { createDefaultDoc, createMixChannel, newDrumKitInstrument, newModularInstrument, newSampleEntity } from './factory'
import { collectInstrumentBundle, insertInstrumentBundle } from './instrumentBundle'
import { MASTER_CHANNEL_ID, type DrumKitInstrument, type Entities, type ModularInstrument } from './types'

/** A kit with a sample slot and a synth slot; the synth plays another sample through a `sample` module. */
function kitSong() {
  const doc = createDefaultDoc()
  const e = doc.entities
  const kick = newSampleEntity('Kick', 'aa11', 'kick.wav', 48000, 1, 480)
  const pad = newSampleEntity('Pad', 'bb22', 'pad.wav', 48000, 2, 4800)
  const unused = newSampleEntity('Unused', 'cc33', 'x.wav', 48000, 1, 10)
  for (const s of [kick, pad, unused]) e.samples[s.id] = s

  const synth = newModularInstrument('Pad Synth')
  synth.modules.smp = { id: 'smp', type: 'sample', params: {}, pos: { x: 0, y: 0 }, sampleId: pad.id }
  const bus = createMixChannel('Drums')
  e.mixChannels[bus.id] = bus
  const kit: DrumKitInstrument = {
    ...newDrumKitInstrument('Kit'),
    channelId: bus.id,
    slots: [
      { id: 'sl1', note: 36, sampleId: kick.id, instrumentId: null, baseNote: 60, volume: 1, pan: 0 },
      { id: 'sl2', note: 38, sampleId: null, instrumentId: synth.id, baseNote: 60, volume: 1, pan: 0 },
    ],
  }
  e.instruments[synth.id] = synth
  e.instruments[kit.id] = kit
  return { doc, kit, synth, kick, pad }
}

describe('collectInstrumentBundle', () => {
  it('gathers the root, its sub-instruments and only the samples they use', () => {
    const { doc, kit, synth, kick, pad } = kitSong()
    const b = collectInstrumentBundle(doc.entities, kit.id)
    expect(b.rootId).toBe(kit.id)
    expect(Object.keys(b.instruments).sort()).toEqual([kit.id, synth.id].sort())
    expect(Object.keys(b.samples).sort()).toEqual([kick.id, pad.id].sort())
  })

  it('survives cycles and dangling references', () => {
    const { doc, kit } = kitSong()
    kit.slots.push({ id: 'self', note: 40, sampleId: 'gone', instrumentId: kit.id, baseNote: 60, volume: 1, pan: 0 })
    kit.slots.push({ id: 'lost', note: 41, sampleId: null, instrumentId: 'missing', baseNote: 60, volume: 1, pan: 0 })
    const b = collectInstrumentBundle(doc.entities, kit.id)
    expect(Object.keys(b.instruments)).toHaveLength(2)
    expect(b.samples.gone).toBeUndefined()
  })

  it('throws for an unknown instrument', () => {
    expect(() => collectInstrumentBundle(createDefaultDoc().entities, 'nope')).toThrow(/Unknown/)
  })
})

describe('insertInstrumentBundle', () => {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

  it('copies instruments with fresh ids and rewires slots and sample modules', () => {
    const { doc, kit } = kitSong()
    const bundle = clone(collectInstrumentBundle(doc.entities, kit.id))
    const target: Entities = clone(createDefaultDoc().entities)

    const rootId = insertInstrumentBundle(target, bundle)

    const root = target.instruments[rootId] as DrumKitInstrument
    expect(rootId).not.toBe(kit.id)
    expect(root.name).toBe('Kit')
    const kickSlot = root.slots.find((s) => s.note === 36)!
    const synthSlot = root.slots.find((s) => s.note === 38)!
    expect(target.samples[kickSlot.sampleId!].hash).toBe('aa11')
    const sub = target.instruments[synthSlot.instrumentId!] as ModularInstrument
    expect(sub.name).toBe('Pad Synth')
    const smp = Object.values(sub.modules).find((m) => m.type === 'sample')!
    expect(target.samples[smp.sampleId!].hash).toBe('bb22')
    expect(Object.values(target.samples).map((s) => s.hash).sort()).toEqual(['aa11', 'bb22'])
  })

  it('reuses samples with the same content and adds the rest', () => {
    const { doc, kit, kick } = kitSong()
    const bundle = clone(collectInstrumentBundle(doc.entities, kit.id))
    const target: Entities = clone(createDefaultDoc().entities)
    const existing = { ...kick, id: 'smp_existing', name: 'My Kick' }
    target.samples[existing.id] = existing

    const rootId = insertInstrumentBundle(target, bundle)

    const root = target.instruments[rootId] as DrumKitInstrument
    expect(root.slots.find((s) => s.note === 36)!.sampleId).toBe('smp_existing')
    expect(Object.values(target.samples)).toHaveLength(2)
  })

  it('adds only the root to the mixer and falls back to master for unknown channels', () => {
    const { doc, kit } = kitSong()
    const bundle = clone(collectInstrumentBundle(doc.entities, kit.id))
    const target: Entities = clone(createDefaultDoc().entities)
    const orderBefore = [...target.mixerInstrumentOrder]

    const rootId = insertInstrumentBundle(target, bundle)

    expect(target.mixerInstrumentOrder).toEqual([...orderBefore, rootId])
    expect(target.instruments[rootId].channelId).toBe(MASTER_CHANNEL_ID)
  })

  it('keeps the routing when the channel exists, and inserting twice gives two independent copies', () => {
    const { doc, kit } = kitSong()
    const bundle = collectInstrumentBundle(doc.entities, kit.id)
    const target = clone(doc.entities)
    const a = insertInstrumentBundle(target, bundle)
    const b = insertInstrumentBundle(target, bundle)
    expect(a).not.toBe(b)
    expect(target.instruments[a].channelId).toBe(kit.channelId)
    const subOf = (id: string) => (target.instruments[id] as DrumKitInstrument).slots.find((s) => s.note === 38)!.instrumentId
    expect(subOf(a)).not.toBe(subOf(b))
    // The source instruments are untouched.
    expect(doc.entities.instruments[kit.id]).toBe(kit)
  })

  it('drops sample references the bundle has no sample for', () => {
    const { doc, kit, kick } = kitSong()
    const bundle = clone(collectInstrumentBundle(doc.entities, kit.id))
    delete bundle.samples[kick.id]
    const target: Entities = clone(createDefaultDoc().entities)
    const root = target.instruments[insertInstrumentBundle(target, bundle)] as DrumKitInstrument
    expect(root.slots.find((s) => s.note === 36)!.sampleId).toBeNull()
  })
})
