import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDoc, newSampleEntity } from '../domain/factory'
import { createMemoryBackend } from '../persist/memoryBackend'
import { listLibrarySamples, readLibrarySampleAudio, saveSampleToLibrary } from '../persist/sampleLibrary'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { setStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import {
  addImportedSamplesToLibrary, addLibrarySamplesToSong, exportLibrarySampleFile, importSampleFiles, importSampleFilesToLibrary,
  saveSongSampleToLibrary,
} from './sampleActions'

// Decoding needs an AudioContext; fake it from the file's first byte.
vi.mock('../audio/sampleLoader', () => ({
  loadAudioFile: async (file: File) => {
    const [b] = new Uint8Array(await file.arrayBuffer())
    if (b === 0) throw new Error('Unable to decode')
    return { hash: `h${b}`, sampleRate: 48000, channels: 1, frames: 100, sampleData: new Float32Array(100) }
  },
}))

const samples = () => Object.values(useDocStore.getState().doc.entities.samples)
const slug = () => useProjectStore.getState().slug

describe('sampleActions', () => {
  beforeEach(() => {
    setStorage(createMemoryBackend())
    useDocStore.getState().loadDoc(createDefaultDoc())
    useProjectStore.getState().reset('Song', '2026-01-01T00:00:00.000Z')
  })

  it('imports files as one undo step, storing their bytes and reporting failures', async () => {
    const before = useDocStore.getState().doc
    const { imported, failed } = await importSampleFiles([
      new File([new Uint8Array([7, 7])], 'snare.wav'),
      new File([new Uint8Array([0])], 'broken.wav'),
    ])
    expect(imported.map((i) => [i.fileName, i.sample.name, i.sample.hash])).toEqual([['snare.wav', 'snare', 'h7']])
    expect(failed).toEqual([{ fileName: 'broken.wav', error: 'Unable to decode' }])
    expect(samples().map((s) => s.name)).toEqual(['snare'])
    expect([...new Uint8Array((await readSampleAsset(slug(), 'h7'))!)]).toEqual([7, 7])
    useDocStore.getState().undo()
    expect(useDocStore.getState().doc).toEqual(before)

    await addImportedSamplesToLibrary(imported)
    expect((await listLibrarySamples()).map((i) => [i.name, i.fileName])).toEqual([['snare', 'snare.wav']])
  })

  it('saves a song sample to the library, and fails clearly when its audio is missing', async () => {
    const smp = newSampleEntity('Hat', 'h9', 'hat.wav', 44100, 1, 10)
    useDocStore.getState().addSampleEntity(smp)
    await expect(saveSongSampleToLibrary(smp.id, {})).rejects.toThrow(/missing/)
    await writeSampleData(slug(), 'h9', new Uint8Array([9]).buffer)
    const id = await saveSongSampleToLibrary(smp.id, { name: 'Open Hat', tags: ['hat'] })
    const audio = (await readLibrarySampleAudio(id))!
    expect(audio.item).toMatchObject({ name: 'Open Hat', tags: ['hat'], fileName: 'hat.wav' })
    expect([...new Uint8Array(audio.bytes)]).toEqual([9])
  })

  it('adds library samples to the song, reusing ones with the same audio', async () => {
    const a = await saveSampleToLibrary(newSampleEntity('A', 'ha', 'a.wav', 48000, 1, 10), new Uint8Array([1]).buffer)
    const b = await saveSampleToLibrary(newSampleEntity('B', 'hb', 'b.wav', 48000, 2, 20), new Uint8Array([2]).buffer)
    const existing = newSampleEntity('Mine', 'hb', 'mine.wav', 48000, 2, 20)
    useDocStore.getState().addSampleEntity(existing)

    const ids = await addLibrarySamplesToSong([a, 'missing', b])

    expect(ids[1]).toBe(existing.id)
    expect(samples().map((s) => s.name).sort()).toEqual(['A', 'Mine'])
    expect([...new Uint8Array((await readSampleAsset(slug(), 'ha'))!)]).toEqual([1])
  })

  it('exports the original audio file', async () => {
    const id = await saveSampleToLibrary(newSampleEntity('A', 'ha', 'a.wav', 48000, 1, 10), new Uint8Array([4]).buffer)
    const { blob, filename } = await exportLibrarySampleFile(id)
    expect(filename).toBe('a.wav')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([4])
    await expect(exportLibrarySampleFile('nope')).rejects.toThrow(/missing/)
  })

  it('imports audio into the library only', async () => {
    const before = useDocStore.getState().doc
    const { ids, failed } = await importSampleFilesToLibrary([
      new File([new Uint8Array([5, 5])], 'clap.wav'),
      new File([new Uint8Array([0])], 'broken.wav'),
    ])
    expect(failed.map((f) => f.fileName)).toEqual(['broken.wav'])
    expect(useDocStore.getState().doc).toBe(before)
    const audio = (await readLibrarySampleAudio(ids[0]))!
    expect(audio.item).toMatchObject({ name: 'clap', fileName: 'clap.wav', sample: { hash: 'h5' } })
    expect([...new Uint8Array(audio.bytes)]).toEqual([5, 5])
  })

  describe('library attributes', () => {
    const songSample = (id: string) => useDocStore.getState().doc.entities.samples[id]

    it('come along from the library, and saving back replaces the linked item', async () => {
      const libId = await saveSampleToLibrary(newSampleEntity('Kick', 'hk', 'kick.wav', 48000, 1, 10), new Uint8Array([1]).buffer,
        { category: 'Drums', tags: ['punchy'] })
      const [songId] = await addLibrarySamplesToSong([libId])
      expect(songSample(songId).library).toEqual({ id: libId, category: 'Drums', tags: ['punchy'] })

      const saved = await saveSongSampleToLibrary(songId, { name: 'Kick', category: 'Drums', tags: ['punchy', 'short'], replaceId: libId })
      expect(saved).toBe(libId)
      expect((await listLibrarySamples()).map((i) => [i.id, i.tags])).toEqual([[libId, ['punchy', 'short']]])
      expect(songSample(songId).library).toEqual({ id: libId, category: 'Drums', tags: ['punchy', 'short'] })
    })

    it('link imported samples that are also added to the library', async () => {
      const { imported } = await importSampleFiles([new File([new Uint8Array([6])], 'rim.wav')])
      await addImportedSamplesToLibrary(imported)
      const [item] = await listLibrarySamples()
      expect(songSample(imported[0].sample.id).library).toEqual({ id: item.id, category: '', tags: [] })
    })
  })
})
