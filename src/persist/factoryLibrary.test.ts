import { beforeEach, describe, expect, it } from 'vitest'
import { FACTORY_INSTRUMENTS } from '../domain/presets/factoryInstruments'
import { seedFactoryInstruments } from './factoryLibrary'
import { deleteLibraryInstrument, listLibraryInstruments, readLibraryInstrument } from './instrumentLibrary'
import { createMemoryBackend } from './memoryBackend'
import { setStorage } from './storage'

const NOW = new Date('2026-10-19T10:00:00Z')

describe('seedFactoryInstruments', () => {
  let mem: ReturnType<typeof createMemoryBackend>
  beforeEach(() => {
    mem = createMemoryBackend()
    setStorage(mem)
  })

  it('adds every factory instrument to the library with its category and tags', async () => {
    expect(await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)).toEqual(FACTORY_INSTRUMENTS.map((p) => p.id))
    const items = await listLibraryInstruments()
    expect(items).toHaveLength(20)
    expect(items.find((i) => i.id === 'acid-bass')).toMatchObject({
      name: 'Acid Bass', kind: 'modular', category: 'Bass', tags: ['acid', 'techno', '303', 'mono'],
      createdAt: NOW.toISOString(), modifiedAt: NOW.toISOString(),
    })
    const read = await readLibraryInstrument('wobble-bass')
    expect(read?.bundle.instruments[read.bundle.rootId]).toEqual(FACTORY_INSTRUMENTS.find((p) => p.id === 'wobble-bass')!.build())
  })

  it('seeds once: deleted presets stay deleted', async () => {
    await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)
    await deleteLibraryInstrument('chip-lead')
    expect(await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)).toEqual([])
    expect(await readLibraryInstrument('chip-lead')).toBeNull()
  })

  it('adds presets that are new since the last seeding', async () => {
    await seedFactoryInstruments(FACTORY_INSTRUMENTS.slice(0, 5), NOW)
    expect(await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)).toEqual(FACTORY_INSTRUMENTS.slice(5).map((p) => p.id))
  })

  it('never overwrites a library item that already has the folder name', async () => {
    await mem.write('instruments/sub-bass/instrument.json', 'mine')
    const written = await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)
    expect(written).not.toContain('sub-bass')
    expect(await mem.readText('instruments/sub-bass/instrument.json')).toBe('mine')
    expect(await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)).toEqual([])
  })

  it('starts over from an unreadable manifest without duplicating items', async () => {
    await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)
    await mem.write('instruments/.factory.json', '{oops')
    expect(await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)).toEqual([])
    expect(await listLibraryInstruments()).toHaveLength(20)
  })

  it('does nothing without storage', async () => {
    setStorage(null)
    expect(await seedFactoryInstruments(FACTORY_INSTRUMENTS, NOW)).toEqual([])
  })
})
