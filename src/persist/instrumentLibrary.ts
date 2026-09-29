/**
 * The instrument library in the active storage backend:
 *
 *   instruments/
 *     <id>/
 *       instrument.json   ← bundle + library metadata (same JSON as inside a .synthinst)
 *       samples/<hash>.bin
 */
import type { InstrumentBundle } from '../domain/instrumentBundle'
import { normalizeTags, uniqueLibraryId, type LibraryItem, type LibraryMeta } from '../domain/library'
import { packInstrumentFile, parseInstrumentJson, serializeInstrumentBundle, type InstrumentDocument } from './instrumentFile'
import { slugify } from './songStore'
import { joinPath, requireStorage } from './storage'

const LIBRARY_DIR = 'instruments'
const ITEM_FILE = 'instrument.json'

const itemDir = (id: string) => joinPath(LIBRARY_DIR, id)
const itemFile = (id: string) => joinPath(itemDir(id), ITEM_FILE)
const samplePath = (id: string, hash: string) => joinPath(itemDir(id), 'samples', `${hash}.bin`)

function toItem(id: string, doc: InstrumentDocument): LibraryItem {
  const root = doc.bundle.instruments[doc.bundle.rootId]
  const meta = doc.meta ?? { category: '', tags: [], createdAt: '', modifiedAt: '' }
  return { id, name: root.name, kind: root.kind, ...meta }
}

/** Reads one library instrument, or null if it's missing. */
export async function readLibraryInstrument(id: string): Promise<(InstrumentDocument & { item: LibraryItem }) | null> {
  const text = await requireStorage().readText(itemFile(id))
  if (text === null) return null
  const doc = parseInstrumentJson(text)
  return { ...doc, item: toItem(id, doc) }
}

/** Every readable library instrument; unreadable folders are skipped. */
export async function listLibraryInstruments(): Promise<LibraryItem[]> {
  const out: LibraryItem[] = []
  for (const entry of await requireStorage().list(LIBRARY_DIR)) {
    if (entry.kind !== 'directory') continue
    const item = await readLibraryInstrument(entry.name).then((r) => r?.item ?? null, () => null)
    if (item) out.push(item)
  }
  return out
}

export function readLibrarySample(id: string, hash: string): Promise<ArrayBuffer | null> {
  return requireStorage().readBytes(samplePath(id, hash))
}

export interface SaveToLibraryOptions {
  category?: string
  tags?: string[]
  /** Overwrite this library item (keeping its creation date) instead of adding a new one. */
  replaceId?: string
}

/** Stores a bundle and the sample bytes `readSample` finds; returns the library id. */
export async function saveToLibrary(
  bundle: InstrumentBundle,
  readSample: (hash: string) => Promise<ArrayBuffer | null>,
  { category = '', tags = [], replaceId }: SaveToLibraryOptions = {},
): Promise<string> {
  const s = requireStorage()
  const now = new Date().toISOString()
  let id: string
  let createdAt = now
  if (replaceId) {
    id = replaceId
    createdAt = (await readLibraryInstrument(replaceId))?.meta?.createdAt || now
    await s.remove(itemDir(id))
  } else {
    const taken = (await s.list(LIBRARY_DIR)).map((e) => e.name)
    id = uniqueLibraryId(slugify(bundle.instruments[bundle.rootId].name), taken)
  }
  for (const smp of Object.values(bundle.samples)) {
    const data = await readSample(smp.hash)
    if (data) await s.write(samplePath(id, smp.hash), data)
  }
  const meta: LibraryMeta = { category: category.trim(), tags: normalizeTags(tags), createdAt, modifiedAt: now }
  await s.write(itemFile(id), serializeInstrumentBundle(bundle, meta))
  return id
}

export interface LibraryItemPatch {
  name?: string
  category?: string
  tags?: string[]
}

const pendingUpdates = new Map<string, Promise<unknown>>()

/** Renames or re-tags a library instrument; the name is the root instrument's name. Updates to one item run in order. */
export function updateLibraryItem(id: string, patch: LibraryItemPatch): Promise<LibraryItem> {
  const run = () => applyUpdate(id, patch)
  const next = (pendingUpdates.get(id) ?? Promise.resolve()).then(run, run)
  pendingUpdates.set(id, next)
  return next
}

async function applyUpdate(id: string, patch: LibraryItemPatch): Promise<LibraryItem> {
  const current = await readLibraryInstrument(id)
  if (!current) throw new Error(`Library instrument not found: ${id}`)
  const { bundle } = current
  const root = bundle.instruments[bundle.rootId]
  const name = patch.name?.trim()
  const updated: InstrumentBundle = name
    ? { ...bundle, instruments: { ...bundle.instruments, [bundle.rootId]: { ...root, name } } }
    : bundle
  const meta: LibraryMeta = {
    category: patch.category !== undefined ? patch.category.trim() : current.item.category,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.item.tags,
    createdAt: current.item.createdAt,
    modifiedAt: new Date().toISOString(),
  }
  await requireStorage().write(itemFile(id), serializeInstrumentBundle(updated, meta))
  return toItem(id, { bundle: updated, meta })
}

export async function deleteLibraryInstrument(id: string): Promise<void> {
  await requireStorage().remove(itemDir(id))
}

/** A `.synthinst` zip of a library instrument, keeping its category and tags. */
export async function exportLibraryInstrument(id: string): Promise<{ zip: Uint8Array; name: string }> {
  const current = await readLibraryInstrument(id)
  if (!current) throw new Error(`Library instrument not found: ${id}`)
  const zip = await packInstrumentFile(current.bundle, (hash) => readLibrarySample(id, hash), current.meta)
  return { zip, name: current.item.name }
}
