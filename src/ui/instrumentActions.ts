import { collectInstrumentBundle, insertInstrumentBundle, type InstrumentBundle } from '../domain/instrumentBundle'
import type { Id, InstrumentLibraryInfo } from '../domain/types'
import type { LibraryMeta } from '../domain/library'
import {
  exportLibraryInstrument, readLibraryInstrument, readLibrarySample, saveToLibrary, type SaveToLibraryOptions,
} from '../persist/instrumentLibrary'
import { INSTRUMENT_FILE_EXT, packInstrumentFile, unpackInstrumentFile, type InstrumentFileContents } from '../persist/instrumentFile'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { hasStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import type { LibraryImportResult } from './library/libraryImport'

const currentSlug = () => useProjectStore.getState().slug

function readSongSample(hash: string): Promise<ArrayBuffer | null> {
  return hasStorage() ? readSampleAsset(currentSlug(), hash) : Promise.resolve(null)
}

function zipBlob(zip: Uint8Array, name: string) {
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), filename: `${name || 'instrument'}${INSTRUMENT_FILE_EXT}` }
}

type SongInsert = { bundle: InstrumentBundle; library?: InstrumentLibraryInfo }

/** Copies sample bytes into the open song, then adds all bundles as one undoable edit. */
async function addBundlesToSong(items: SongInsert[], readSample: (itemIndex: number, hash: string) => Promise<ArrayBuffer | null>): Promise<Id[]> {
  if (hasStorage()) {
    for (const [i, { bundle }] of items.entries()) {
      for (const smp of Object.values(bundle.samples)) {
        const data = await readSample(i, smp.hash)
        if (data) await writeSampleData(currentSlug(), smp.hash, data)
      }
    }
  }
  const ids: Id[] = []
  useDocStore.getState().mutate((draft) => {
    for (const { bundle, library } of items) ids.push(insertInstrumentBundle(draft.entities, bundle, library))
  })
  return ids
}

const bytesToBuffer = (bytes: Uint8Array | undefined) => (bytes ? bytes.slice().buffer as ArrayBuffer : null)

/** Category and tags from a file or library item, without the library link. */
const infoFromMeta = (meta: LibraryMeta | null): InstrumentLibraryInfo | undefined =>
  meta ? { category: meta.category, tags: meta.tags } : undefined

/** Links song instruments to library items and records their category/tags, as one undoable edit. */
function linkToLibrary(links: { instrumentId: Id; library: InstrumentLibraryInfo }[]) {
  if (!links.length) return
  useDocStore.getState().mutate((draft) => {
    for (const { instrumentId, library } of links) {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.library = { ...library, tags: [...library.tags] }
    }
  })
}

/** A `.synthinst` file of the instrument with its sub-instruments and sample data. */
export async function exportInstrumentFile(instrumentId: Id): Promise<{ blob: Blob; filename: string }> {
  const { entities } = useDocStore.getState().doc
  const { library, name } = entities.instruments[instrumentId]
  const now = new Date().toISOString()
  const meta = library ? { category: library.category, tags: library.tags, createdAt: now, modifiedAt: now } : null
  const zip = await packInstrumentFile(collectInstrumentBundle(entities, instrumentId), readSongSample, meta)
  return zipBlob(zip, name)
}

/** Adds one instrument file to the open song; returns the new instrument id. */
export async function importInstrumentFile(data: ArrayBuffer): Promise<Id> {
  const { bundle, meta, sampleData } = unpackInstrumentFile(data)
  const [id] = await addBundlesToSong([{ bundle, library: infoFromMeta(meta) }], async (_, hash) => bytesToBuffer(sampleData[hash]))
  return id
}

export interface ImportedInstrument {
  fileName: string
  /** The copy added to the song. */
  instrumentId: Id
  name: string
  contents: InstrumentFileContents
}

/** Adds instrument files to the open song as one undoable edit; unreadable files are reported, not thrown. */
export async function importInstrumentFiles(files: File[]): Promise<{ imported: ImportedInstrument[]; failed: { fileName: string; error: string }[] }> {
  const parsed: { fileName: string; contents: InstrumentFileContents }[] = []
  const failed: { fileName: string; error: string }[] = []
  for (const file of files) {
    try {
      parsed.push({ fileName: file.name, contents: unpackInstrumentFile(await file.arrayBuffer()) })
    } catch (err) {
      failed.push({ fileName: file.name, error: (err as Error).message })
    }
  }
  const ids = await addBundlesToSong(
    parsed.map((p) => ({ bundle: p.contents.bundle, library: infoFromMeta(p.contents.meta) })),
    async (i, hash) => bytesToBuffer(parsed[i].contents.sampleData[hash]),
  )
  const imported = parsed.map((p, i) => ({
    fileName: p.fileName,
    instrumentId: ids[i],
    name: p.contents.bundle.instruments[p.contents.bundle.rootId].name,
    contents: p.contents,
  }))
  return { imported, failed }
}

/** Stores imported files in the library (with the category and tags they carried) and links the song's copies to them. */
export async function addImportedToLibrary(items: ImportedInstrument[]): Promise<void> {
  const links: { instrumentId: Id; library: InstrumentLibraryInfo }[] = []
  for (const { contents, instrumentId } of items) {
    const category = contents.meta?.category ?? ''
    const tags = contents.meta?.tags ?? []
    const id = await saveToLibrary(contents.bundle, async (hash) => bytesToBuffer(contents.sampleData[hash]) ?? readSongSample(hash), { category, tags })
    links.push({ instrumentId, library: { id, category, tags } })
  }
  linkToLibrary(links)
}

/** Saves a song instrument (with its sub-instruments and samples) to the library under `name`, and links it to that item. */
export async function saveSongInstrumentToLibrary(instrumentId: Id, name: string, options: SaveToLibraryOptions): Promise<string> {
  const bundle = collectInstrumentBundle(useDocStore.getState().doc.entities, instrumentId)
  const root = bundle.instruments[bundle.rootId]
  const named = { ...bundle, instruments: { ...bundle.instruments, [bundle.rootId]: { ...root, name: name.trim() || root.name } } }
  const id = await saveToLibrary(named, readSongSample, options)
  linkToLibrary([{ instrumentId, library: { id, category: (options.category ?? '').trim(), tags: options.tags ?? [] } }])
  return id
}

/** Adds copies of library instruments to the open song as one undoable edit; returns their new ids. */
export async function addLibraryInstrumentsToSong(libraryIds: string[]): Promise<Id[]> {
  const docs: { id: string; bundle: InstrumentBundle; library: InstrumentLibraryInfo }[] = []
  for (const id of libraryIds) {
    const doc = await readLibraryInstrument(id)
    if (doc) docs.push({ id, bundle: doc.bundle, library: { id, category: doc.item.category, tags: doc.item.tags } })
  }
  return addBundlesToSong(docs, (i, hash) => readLibrarySample(docs[i].id, hash))
}

export async function exportLibraryInstrumentFile(libraryId: string): Promise<{ blob: Blob; filename: string }> {
  const { zip, name } = await exportLibraryInstrument(libraryId)
  return zipBlob(zip, name)
}

/** Adds instrument files to the library only, keeping the category and tags they carry; returns the new library ids. */
export async function importInstrumentFilesToLibrary(files: File[]): Promise<LibraryImportResult> {
  const ids: string[] = []
  const failed: { fileName: string; error: string }[] = []
  for (const file of files) {
    try {
      const { bundle, meta, sampleData } = unpackInstrumentFile(await file.arrayBuffer())
      ids.push(await saveToLibrary(bundle, async (hash) => bytesToBuffer(sampleData[hash]), { category: meta?.category, tags: meta?.tags }))
    } catch (err) {
      failed.push({ fileName: file.name, error: (err as Error).message })
    }
  }
  return { ids, failed }
}
