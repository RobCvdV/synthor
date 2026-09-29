import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultDoc, newModularInstrument, newSampleEntity } from '../domain/factory'
import type { ModularInstrument } from '../domain/types'
import { createMemoryBackend } from '../persist/memoryBackend'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { setStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { listLibraryInstruments, readLibraryInstrument, readLibrarySample, saveToLibrary } from '../persist/instrumentLibrary'
import { packInstrumentFile } from '../persist/instrumentFile'
import {
  addImportedToLibrary, addLibraryInstrumentsToSong, exportInstrumentFile, importInstrumentFile, importInstrumentFiles,
  saveSongInstrumentToLibrary,
} from './instrumentActions'

describe('instrumentActions', () => {
  beforeEach(() => {
    setStorage(createMemoryBackend())
    useDocStore.getState().loadDoc(createDefaultDoc())
    useProjectStore.getState().reset('Source', '2026-01-01T00:00:00.000Z')
  })

  it('exports an instrument with its sample bytes and imports it into another song', async () => {
    const synth = newModularInstrument('Keys')
    const smp = newSampleEntity('Piano', 'feed01', 'piano.wav', 48000, 1, 4)
    synth.modules.s = { id: 's', type: 'sample', params: {}, pos: { x: 0, y: 0 }, sampleId: smp.id }
    useDocStore.getState().mutate((d) => {
      d.entities.samples[smp.id] = smp
      d.entities.instruments[synth.id] = synth
    })
    await writeSampleData(useProjectStore.getState().slug, 'feed01', new Uint8Array([9, 8, 7]).buffer)

    const { blob, filename } = await exportInstrumentFile(synth.id)
    expect(filename).toBe('Keys.synthinst')
    const data = await blob.arrayBuffer()
    expect(Object.keys(unzipSync(new Uint8Array(data))).sort()).toEqual(['instrument.json', 'samples/feed01.bin'])

    useDocStore.getState().loadDoc(createDefaultDoc())
    useProjectStore.getState().reset('Target', '2026-01-01T00:00:00.000Z')
    const id = await importInstrumentFile(data)

    const { entities } = useDocStore.getState().doc
    const imported = entities.instruments[id] as ModularInstrument
    expect(imported.name).toBe('Keys')
    const sampleId = Object.values(imported.modules).find((m) => m.type === 'sample')!.sampleId!
    expect(entities.samples[sampleId].hash).toBe('feed01')
    expect([...new Uint8Array((await readSampleAsset('target', 'feed01'))!)]).toEqual([9, 8, 7])
    expect(entities.mixerInstrumentOrder).toContain(id)
  })

  it('import is one undo step', async () => {
    const synth = newModularInstrument('Keys')
    useDocStore.getState().mutate((d) => { d.entities.instruments[synth.id] = synth })
    const { blob } = await exportInstrumentFile(synth.id)
    const before = useDocStore.getState().doc
    await importInstrumentFile(await blob.arrayBuffer())
    useDocStore.getState().undo()
    expect(useDocStore.getState().doc).toEqual(before)
  })

  /** A sample-playing synth bundle whose sample bytes are [1, 2]. */
  function toneBundle(name: string) {
    const synth = newModularInstrument(name)
    const smp = newSampleEntity('Tone', 'beef01', 'tone.wav', 48000, 1, 4)
    synth.modules.s = { id: 's', type: 'sample', params: {}, pos: { x: 0, y: 0 }, sampleId: smp.id }
    return { rootId: synth.id, instruments: { [synth.id]: synth }, samples: { [smp.id]: smp } }
  }
  const toneBytes = async () => new Uint8Array([1, 2]).buffer

  it('imports several files as one undo step and reports the unreadable ones', async () => {
    const meta = { category: 'Keys', tags: ['soft'], createdAt: 'c', modifiedAt: 'm' }
    const a = new File([await packInstrumentFile(toneBundle('A'), toneBytes, meta) as BlobPart], 'a.synthinst')
    const b = new File([await packInstrumentFile(toneBundle('B'), toneBytes) as BlobPart], 'b.synthinst')
    const bad = new File(['{"nope":1}'], 'bad.json')
    const before = useDocStore.getState().doc

    const { imported, failed } = await importInstrumentFiles([a, bad, b])

    expect(imported.map((i) => [i.fileName, i.name])).toEqual([['a.synthinst', 'A'], ['b.synthinst', 'B']])
    expect(failed.map((f) => f.fileName)).toEqual(['bad.json'])
    const { entities } = useDocStore.getState().doc
    expect(entities.instruments[imported[0].instrumentId].name).toBe('A')
    expect(Object.values(entities.samples).filter((smp) => smp.hash === 'beef01')).toHaveLength(1)
    useDocStore.getState().undo()
    expect(useDocStore.getState().doc).toEqual(before)

    await addImportedToLibrary(imported.slice(0, 1))
    const [item] = await listLibraryInstruments()
    expect(item).toMatchObject({ name: 'A', category: 'Keys', tags: ['soft'] })
    expect([...new Uint8Array((await readLibrarySample(item.id, 'beef01'))!)]).toEqual([1, 2])
  })

  it('saves a song instrument to the library under a new name without renaming it in the song', async () => {
    const bundle = toneBundle('Keys')
    useDocStore.getState().mutate((d) => {
      Object.assign(d.entities.instruments, bundle.instruments)
      Object.assign(d.entities.samples, bundle.samples)
    })
    await writeSampleData(useProjectStore.getState().slug, 'beef01', new Uint8Array([3]).buffer)

    const id = await saveSongInstrumentToLibrary(bundle.rootId, 'Soft Keys', { category: 'Keys', tags: ['soft'] })

    const saved = (await readLibraryInstrument(id))!
    expect(saved.item).toMatchObject({ name: 'Soft Keys', category: 'Keys', tags: ['soft'] })
    expect([...new Uint8Array((await readLibrarySample(id, 'beef01'))!)]).toEqual([3])
    expect(useDocStore.getState().doc.entities.instruments[bundle.rootId].name).toBe('Keys')
  })

  it('adds library instruments to the song with their sample bytes', async () => {
    const one = await saveToLibrary(toneBundle('One'), toneBytes)
    const two = await saveToLibrary(toneBundle('Two'), toneBytes)
    const before = useDocStore.getState().doc

    const ids = await addLibraryInstrumentsToSong([one, 'missing', two])

    const { entities } = useDocStore.getState().doc
    expect(ids.map((id) => entities.instruments[id].name)).toEqual(['One', 'Two'])
    expect([...new Uint8Array((await readSampleAsset(useProjectStore.getState().slug, 'beef01'))!)]).toEqual([1, 2])
    useDocStore.getState().undo()
    expect(useDocStore.getState().doc).toEqual(before)
  })
})
