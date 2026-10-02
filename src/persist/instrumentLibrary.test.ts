import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { newDrumKitInstrument, newModularInstrument, newSampleEntity } from '../domain/factory'
import type { InstrumentBundle } from '../domain/instrumentBundle'
import { createMemoryBackend } from './memoryBackend'
import {
  deleteLibraryInstrument, exportLibraryInstrument, listLibraryInstruments, readLibraryInstrument, readLibrarySample,
  saveToLibrary, updateLibraryItem,
} from './instrumentLibrary'
import { unpackInstrumentFile } from './instrumentFile'
import { setStorage } from './storage'

function bundle(name: string): InstrumentBundle {
  const synth = newModularInstrument(name)
  const smp = newSampleEntity('Hit', 'ab12', 'hit.wav', 48000, 1, 10)
  synth.modules.s = { id: 's', type: 'sample', params: {}, pos: { x: 0, y: 0 }, sampleId: smp.id }
  return { rootId: synth.id, instruments: { [synth.id]: synth }, samples: { [smp.id]: smp } }
}

const bytes = async () => new Uint8Array([5, 6]).buffer

describe('instrument library', () => {
  let mem: ReturnType<typeof createMemoryBackend>
  beforeEach(() => {
    mem = createMemoryBackend()
    setStorage(mem)
  })

  it('saves a bundle with its samples and lists it', async () => {
    const id = await saveToLibrary(bundle('Warm Pad'), bytes, { category: ' Pads ', tags: ['Warm', 'soft'] })
    expect(id).toBe('warm-pad')
    expect([...mem.files.keys()].sort()).toEqual(['instruments/warm-pad/instrument.json', 'instruments/warm-pad/samples/ab12.bin'])
    const [item] = await listLibraryInstruments()
    expect(item).toMatchObject({ id: 'warm-pad', name: 'Warm Pad', kind: 'modular', category: 'Pads', tags: ['warm', 'soft'] })
    expect(item.createdAt).toBe(item.modifiedAt)
    expect([...new Uint8Array((await readLibrarySample(id, 'ab12'))!)]).toEqual([5, 6])
  })

  it('gives same-named instruments their own folders', async () => {
    await saveToLibrary(bundle('Pad'), bytes)
    expect(await saveToLibrary(bundle('Pad'), bytes)).toBe('pad-2')
    expect((await listLibraryInstruments()).map((i) => i.id).sort()).toEqual(['pad', 'pad-2'])
  })

  it('replaces an item in place, keeping its creation date and dropping stale samples', async () => {
    const id = await saveToLibrary(bundle('Pad'), bytes)
    const created = (await readLibraryInstrument(id))!.item.createdAt
    await mem.write(`instruments/${id}/samples/stale.bin`, new ArrayBuffer(1))
    const replacement = bundle('Pad v2')
    await saveToLibrary(replacement, bytes, { replaceId: id, category: 'New' })
    const back = (await readLibraryInstrument(id))!
    expect(back.item).toMatchObject({ name: 'Pad v2', category: 'New', createdAt: created })
    expect(await mem.exists(`instruments/${id}/samples/stale.bin`)).toBe(false)
  })

  it('renames, recategorizes and retags', async () => {
    const id = await saveToLibrary(bundle('Pad'), bytes, { category: 'Pads', tags: ['a'] })
    const updated = await updateLibraryItem(id, { name: ' Lush Pad ', tags: ['B', 'b', 'c'] })
    expect(updated).toMatchObject({ id, name: 'Lush Pad', category: 'Pads', tags: ['b', 'c'] })
    const back = (await readLibraryInstrument(id))!
    expect(back.bundle.instruments[back.bundle.rootId].name).toBe('Lush Pad')
    expect((await updateLibraryItem(id, { category: '' })).category).toBe('')
  })

  it('applies overlapping updates to one item in order', async () => {
    const id = await saveToLibrary(bundle('Pad'), bytes)
    await Promise.all([
      updateLibraryItem(id, { name: 'Lush' }),
      updateLibraryItem(id, { category: 'Pads' }),
      updateLibraryItem(id, { tags: ['x'] }),
    ])
    expect((await readLibraryInstrument(id))!.item).toMatchObject({ name: 'Lush', category: 'Pads', tags: ['x'] })
  })

  it('skips unreadable folders and loose files when listing', async () => {
    await saveToLibrary(bundle('Pad'), bytes)
    await mem.write('instruments/broken/instrument.json', '{nope')
    await mem.write('instruments/readme.txt', 'hi')
    expect((await listLibraryInstruments()).map((i) => i.id)).toEqual(['pad'])
  })

  it('lists drum kits too', async () => {
    const kit = newDrumKitInstrument('Kit')
    await saveToLibrary({ rootId: kit.id, instruments: { [kit.id]: kit }, samples: {} }, bytes)
    expect((await listLibraryInstruments())[0]).toMatchObject({ kind: 'drumkit', category: '', tags: [] })
  })

  it('exports a .synthinst with samples and metadata, and deletes', async () => {
    const id = await saveToLibrary(bundle('Pad'), bytes, { category: 'Pads', tags: ['warm'] })
    const { zip, name } = await exportLibraryInstrument(id)
    expect(name).toBe('Pad')
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['instrument.json', 'samples/ab12.bin'])
    expect(unpackInstrumentFile(zip).meta).toMatchObject({ category: 'Pads', tags: ['warm'] })

    await deleteLibraryInstrument(id)
    expect(await listLibraryInstruments()).toEqual([])
    await expect(exportLibraryInstrument(id)).rejects.toThrow(/not found/)
  })
})
