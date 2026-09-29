/** Library item metadata, filtering and sorting — pure, shared by the instrument and sample libraries. */
import type { Id, Instrument, SampleEntity } from './types'

/** What the library knows about an item besides the item itself. */
export interface LibraryMeta {
  category: string
  tags: string[]
  createdAt: string
  modifiedAt: string
}

export interface LibraryItem extends LibraryMeta {
  /** Folder name in the library; stable across renames. */
  id: string
  name: string
}

export interface InstrumentLibraryItem extends LibraryItem {
  kind: Instrument['kind']
}

export interface SampleLibraryItem extends LibraryItem {
  sample: Omit<SampleEntity, 'id' | 'name'>
  /** The audio file's name inside the item folder. */
  fileName: string
}

export interface LibraryFilter {
  /** Words that must all appear in the name, category or tags. */
  text: string
  /** Only this category; null = any. */
  category: string | null
}

export type LibrarySortKey = 'name'

/** Sort options offered in the library, in menu order. */
export const LIBRARY_SORTS: { key: LibrarySortKey; label: string; compare: (a: LibraryItem, b: LibraryItem) => number }[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) },
]

/** Trimmed, lowercased, unique, non-empty tags. */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

/** Splits free text ("bass, warm  pad") into tags. */
export function parseTags(text: string): string[] {
  return normalizeTags(text.split(/[,\s]+/))
}

export function filterLibrary<T extends LibraryItem>(items: T[], filter: LibraryFilter): T[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    if (filter.category !== null && item.category !== filter.category) return false
    const haystack = [item.name, item.category, ...item.tags].join(' ').toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

export function sortLibrary<T extends LibraryItem>(items: T[], key: LibrarySortKey, descending = false): T[] {
  const sort = LIBRARY_SORTS.find((s) => s.key === key) ?? LIBRARY_SORTS[0]
  const sorted = [...items].sort(sort.compare)
  return descending ? sorted.reverse() : sorted
}

/** Distinct non-empty categories, sorted. */
export function libraryCategories(items: LibraryItem[]): string[] {
  return [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Distinct tags, sorted. */
export function libraryTags(items: LibraryItem[]): string[] {
  return [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b))
}

/** A library folder name for `name` that isn't in `taken`: "warm-pad", "warm-pad-2", … */
export function uniqueLibraryId(slug: string, taken: Iterable<Id>): string {
  const used = new Set(taken)
  if (!used.has(slug)) return slug
  let n = 2
  while (used.has(`${slug}-${n}`)) n++
  return `${slug}-${n}`
}
