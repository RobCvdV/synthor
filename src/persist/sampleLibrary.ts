/**
 * The sample library in the active storage backend:
 *
 *   samples/
 *     <id>/
 *       sample.json    ← name, audio metadata and library metadata
 *       <file name>    ← the original audio file, as imported
 */
import { normalizeTags, uniqueLibraryId, type SampleLibraryItem } from '../domain/library'
import type { SampleEntity } from '../domain/types'
import { createKeyedQueue } from './keyedQueue'
import { slugify } from './songStore'
import { joinPath, requireStorage } from './storage'

const LIBRARY_DIR = 'samples'
const ITEM_FILE = 'sample.json'
const FORMAT = 'synthor-sample'

const itemDir = (id: string) => joinPath(LIBRARY_DIR, id)
const itemFile = (id: string) => joinPath(itemDir(id), ITEM_FILE)

/** A file name that is safe inside the item folder and never clashes with sample.json. */
export function safeAudioFileName(name: string): string {
  const cleaned = name.replace(/[/\\:\0]/g, '_').replace(/^\.+/, '').trim()
  return !cleaned || cleaned === ITEM_FILE ? 'audio.wav' : cleaned
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function serialize(item: Omit<SampleLibraryItem, 'id'>): string {
  const { name, sample, fileName, category, tags, createdAt, modifiedAt } = item
  return JSON.stringify({ format: FORMAT, version: 1, name, fileName, sample, meta: { category, tags, createdAt, modifiedAt } }, null, 2)
}

function parse(id: string, text: string): SampleLibraryItem {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw) || raw.format !== FORMAT || !isRecord(raw.sample) || typeof raw.fileName !== 'string') {
    throw new Error('Not a valid library sample')
  }
  const s = raw.sample
  if (typeof s.hash !== 'string' || typeof s.sampleRate !== 'number' || typeof s.channels !== 'number' || typeof s.frames !== 'number') {
    throw new Error('Not a valid library sample')
  }
  const meta = isRecord(raw.meta) ? raw.meta : {}
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    id,
    name: str(raw.name) || id,
    fileName: raw.fileName,
    sample: {
      hash: s.hash, originalName: str(s.originalName), sampleRate: s.sampleRate, channels: s.channels, frames: s.frames,
      ...(typeof s.cycleLength === 'number' && s.cycleLength > 0 ? { cycleLength: s.cycleLength } : {}),
    },
    category: str(meta.category),
    tags: normalizeTags(Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : []),
    createdAt: str(meta.createdAt),
    modifiedAt: str(meta.modifiedAt),
  }
}

export async function readLibrarySampleItem(id: string): Promise<SampleLibraryItem | null> {
  const text = await requireStorage().readText(itemFile(id))
  return text === null ? null : parse(id, text)
}

/** Every readable library sample; unreadable folders are skipped. */
export async function listLibrarySamples(): Promise<SampleLibraryItem[]> {
  const out: SampleLibraryItem[] = []
  for (const entry of await requireStorage().list(LIBRARY_DIR)) {
    if (entry.kind !== 'directory') continue
    const item = await readLibrarySampleItem(entry.name).catch(() => null)
    if (item) out.push(item)
  }
  return out
}

/** The audio file of a library sample. */
export async function readLibrarySampleAudio(id: string): Promise<{ item: SampleLibraryItem; bytes: ArrayBuffer } | null> {
  const item = await readLibrarySampleItem(id)
  if (!item) return null
  const bytes = await requireStorage().readBytes(joinPath(itemDir(id), item.fileName))
  return bytes ? { item, bytes } : null
}

export interface SaveSampleOptions {
  name?: string
  category?: string
  tags?: string[]
  /** Overwrite this library item (keeping its creation date) instead of adding a new one. */
  replaceId?: string
}

/** Stores a sample's audio file and metadata; returns the library id. */
export async function saveSampleToLibrary(
  sample: SampleEntity,
  bytes: ArrayBuffer,
  { name = sample.name, category = '', tags = [], replaceId }: SaveSampleOptions = {},
): Promise<string> {
  const s = requireStorage()
  const now = new Date().toISOString()
  let id: string
  let createdAt = now
  if (replaceId) {
    id = replaceId
    createdAt = (await readLibrarySampleItem(replaceId).catch(() => null))?.createdAt || now
    await s.remove(itemDir(id))
  } else {
    id = uniqueLibraryId(slugify(name), (await s.list(LIBRARY_DIR)).map((e) => e.name))
  }
  const fileName = safeAudioFileName(sample.originalName || `${name}.wav`)
  const { hash, originalName, sampleRate, channels, frames, cycleLength } = sample
  await s.write(joinPath(itemDir(id), fileName), bytes)
  await s.write(itemFile(id), serialize({
    name: name.trim() || sample.name,
    fileName,
    sample: { hash, originalName, sampleRate, channels, frames, ...(cycleLength ? { cycleLength } : {}) },
    category: category.trim(),
    tags: normalizeTags(tags),
    createdAt,
    modifiedAt: now,
  }))
  return id
}

export interface SampleItemPatch {
  name?: string
  category?: string
  tags?: string[]
}

const updates = createKeyedQueue()

/** Renames or re-tags a library sample. Updates to one item run in order. */
export function updateLibrarySample(id: string, patch: SampleItemPatch): Promise<SampleLibraryItem> {
  return updates(id, async () => {
    const current = await readLibrarySampleItem(id)
    if (!current) throw new Error(`Library sample not found: ${id}`)
    const updated: SampleLibraryItem = {
      ...current,
      name: patch.name?.trim() || current.name,
      category: patch.category !== undefined ? patch.category.trim() : current.category,
      tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
      modifiedAt: new Date().toISOString(),
    }
    await requireStorage().write(itemFile(id), serialize(updated))
    return updated
  })
}

export async function deleteLibrarySample(id: string): Promise<void> {
  await requireStorage().remove(itemDir(id))
}
