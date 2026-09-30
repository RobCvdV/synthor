import { loadAudioFile } from '../audio/sampleLoader'
import { newSampleEntity } from '../domain/factory'
import type { Id, SampleEntity } from '../domain/types'
import { readLibrarySampleAudio, saveSampleToLibrary, type SaveSampleOptions } from '../persist/sampleLibrary'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { hasStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import type { LibraryImportResult } from './library/libraryImport'

const currentSlug = () => useProjectStore.getState().slug

async function storeInSong(hash: string, bytes: ArrayBuffer): Promise<void> {
  if (hasStorage()) await writeSampleData(currentSlug(), hash, bytes)
}

export interface ImportedSample {
  fileName: string
  sample: SampleEntity
  bytes: ArrayBuffer
}

/** Decodes audio files and adds them to the song as one undoable edit; unreadable files are reported, not thrown. */
export async function importSampleFiles(files: File[]): Promise<{ imported: ImportedSample[]; failed: { fileName: string; error: string }[] }> {
  const imported: ImportedSample[] = []
  const failed: { fileName: string; error: string }[] = []
  for (const file of files) {
    try {
      const loaded = await loadAudioFile(file)
      const bytes = await file.arrayBuffer()
      await storeInSong(loaded.hash, bytes)
      const name = file.name.replace(/\.[^.]+$/, '')
      imported.push({ fileName: file.name, bytes, sample: newSampleEntity(name, loaded.hash, file.name, loaded.sampleRate, loaded.channels, loaded.frames) })
    } catch (err) {
      failed.push({ fileName: file.name, error: (err as Error).message || 'Could not decode audio' })
    }
  }
  if (imported.length) {
    useDocStore.getState().mutate((draft) => {
      for (const { sample } of imported) draft.entities.samples[sample.id] = sample
    })
  }
  return { imported, failed }
}

export async function addImportedSamplesToLibrary(items: ImportedSample[]): Promise<void> {
  for (const { sample, bytes } of items) await saveSampleToLibrary(sample, bytes)
}

/** Saves a song sample's audio file to the library. */
export async function saveSongSampleToLibrary(sampleId: Id, options: SaveSampleOptions): Promise<string> {
  const sample = useDocStore.getState().doc.entities.samples[sampleId]
  if (!sample) throw new Error('Sample not found')
  const bytes = await readSampleAsset(currentSlug(), sample.hash)
  if (!bytes) throw new Error(`The audio of "${sample.name}" is missing`)
  return saveSampleToLibrary(sample, bytes, options)
}

/** Adds library samples to the song as one undoable edit; a sample the song already has (same audio) is reused. */
export async function addLibrarySamplesToSong(libraryIds: string[]): Promise<Id[]> {
  const found: { name: string; bytes: ArrayBuffer; meta: Omit<SampleEntity, 'id' | 'name'> }[] = []
  for (const id of libraryIds) {
    const audio = await readLibrarySampleAudio(id)
    if (!audio) continue
    await storeInSong(audio.item.sample.hash, audio.bytes)
    found.push({ name: audio.item.name, bytes: audio.bytes, meta: audio.item.sample })
  }
  const ids: Id[] = []
  useDocStore.getState().mutate((draft) => {
    for (const { name, meta } of found) {
      const existing = Object.values(draft.entities.samples).find((smp) => smp.hash === meta.hash)
      if (existing) {
        ids.push(existing.id)
        continue
      }
      const sample = newSampleEntity(name, meta.hash, meta.originalName, meta.sampleRate, meta.channels, meta.frames)
      draft.entities.samples[sample.id] = sample
      ids.push(sample.id)
    }
  })
  return ids
}

/** The library sample's audio file, as imported. */
export async function exportLibrarySampleFile(libraryId: string): Promise<{ blob: Blob; filename: string }> {
  const audio = await readLibrarySampleAudio(libraryId)
  if (!audio) throw new Error('The sample or its audio file is missing')
  return { blob: new Blob([audio.bytes]), filename: audio.item.fileName }
}

/** Adds audio files to the library only; returns the new library ids. */
export async function importSampleFilesToLibrary(files: File[]): Promise<LibraryImportResult> {
  const ids: string[] = []
  const failed: { fileName: string; error: string }[] = []
  for (const file of files) {
    try {
      const loaded = await loadAudioFile(file)
      const sample = newSampleEntity(file.name.replace(/\.[^.]+$/, ''), loaded.hash, file.name, loaded.sampleRate, loaded.channels, loaded.frames)
      ids.push(await saveSampleToLibrary(sample, await file.arrayBuffer()))
    } catch (err) {
      failed.push({ fileName: file.name, error: (err as Error).message || 'Could not decode audio' })
    }
  }
  return { ids, failed }
}
