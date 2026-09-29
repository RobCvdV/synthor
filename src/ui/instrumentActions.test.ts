import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultDoc, newModularInstrument, newSampleEntity } from '../domain/factory'
import type { ModularInstrument } from '../domain/types'
import { createMemoryBackend } from '../persist/memoryBackend'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { setStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { exportInstrumentFile, importInstrumentFile } from './instrumentActions'

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
})
