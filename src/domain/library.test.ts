import { describe, expect, it } from 'vitest'
import {
  filterLibrary, LIBRARY_SORTS, libraryCategories, libraryTags, normalizeTags, parseTags, sortLibrary, uniqueLibraryId,
  type InstrumentLibraryItem,
} from './library'

const item = (id: string, name: string, category = '', tags: string[] = []): InstrumentLibraryItem =>
  ({ id, name, kind: 'modular', category, tags, createdAt: '', modifiedAt: '' })

const items = [
  item('a', 'Warm Pad', 'Pads', ['warm', 'slow']),
  item('b', 'acid bass', 'Bass', ['303']),
  item('c', 'Bright Lead', 'Leads', ['warm']),
  item('d', 'Kit 808'),
]

describe('tags', () => {
  it('normalizes: trims, lowercases, dedupes, drops empties', () => {
    expect(normalizeTags([' Warm', 'warm', '', 'SOFT '])).toEqual(['warm', 'soft'])
  })

  it('parses free text on commas and whitespace', () => {
    expect(parseTags('bass, Warm  lo-fi,,')).toEqual(['bass', 'warm', 'lo-fi'])
  })
})

describe('filterLibrary', () => {
  const ids = (list: InstrumentLibraryItem[]) => list.map((i) => i.id)

  it('matches every word against name, category and tags, case-insensitively', () => {
    expect(ids(filterLibrary(items, { text: 'WARM', category: null }))).toEqual(['a', 'c'])
    expect(ids(filterLibrary(items, { text: 'warm lead', category: null }))).toEqual(['c'])
    expect(ids(filterLibrary(items, { text: 'bass', category: null }))).toEqual(['b'])
    expect(ids(filterLibrary(items, { text: '  ', category: null }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('narrows to a category', () => {
    expect(ids(filterLibrary(items, { text: 'warm', category: 'Pads' }))).toEqual(['a'])
    expect(ids(filterLibrary(items, { text: '', category: '' }))).toEqual(['d'])
  })
})

describe('sortLibrary', () => {
  it('sorts by name ignoring case, either direction, without mutating', () => {
    const copy = [...items]
    expect(sortLibrary(items, 'name').map((i) => i.name)).toEqual(['acid bass', 'Bright Lead', 'Kit 808', 'Warm Pad'])
    expect(sortLibrary(items, 'name', true).map((i) => i.id)).toEqual(['a', 'd', 'c', 'b'])
    expect(items).toEqual(copy)
  })

  it('lists every sort option with a label', () => {
    expect(LIBRARY_SORTS.map((s) => [s.key, s.label])).toEqual([['name', 'Name']])
  })
})

describe('library facets and ids', () => {
  it('collects distinct categories and tags', () => {
    expect(libraryCategories(items)).toEqual(['Bass', 'Leads', 'Pads'])
    expect(libraryTags(items)).toEqual(['303', 'slow', 'warm'])
  })

  it('picks a free folder name', () => {
    expect(uniqueLibraryId('pad', [])).toBe('pad')
    expect(uniqueLibraryId('pad', ['pad', 'pad-2'])).toBe('pad-3')
  })
})
