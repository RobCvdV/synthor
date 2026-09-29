import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultDoc } from '../domain/factory'
import { createMemoryBackend } from './memoryBackend'
import { listSampleAssets, readSampleAsset, writeSampleData, deleteSampleAsset } from './sampleStorage'
import { makeSongFile } from './serialize'
import { deleteSong, listSongs, loadRecent, moveSongDir, readSong, saveRecent, slugify, writeSong } from './songStore'
import { setStorage } from './storage'

const song = (name: string) =>
  makeSongFile(createDefaultDoc(), { name, createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z' })

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My First Song')).toBe('my-first-song')
  })

  it('strips punctuation and collapses separators', () => {
    expect(slugify('  Hello, World!! ')).toBe('hello-world')
    expect(slugify('a___b   c')).toBe('a-b-c')
  })

  it('falls back to "untitled" for empty/symbol-only names', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('!!!')).toBe('untitled')
  })
})

describe('songStore', () => {
  let mem: ReturnType<typeof createMemoryBackend>
  beforeEach(() => {
    mem = createMemoryBackend()
    setStorage(mem)
  })

  it('writes under the name slug and reads it back', async () => {
    const slug = await writeSong(song('My Song'))
    expect(slug).toBe('my-song')
    expect(mem.files.has('songs/my-song/song.json')).toBe(true)
    expect((await readSong('my-song'))?.meta.name).toBe('My Song')
  })

  it('returns null for an unknown song', async () => {
    expect(await readSong('nope')).toBeNull()
  })

  it('lists readable songs and skips broken ones', async () => {
    await writeSong(song('One'))
    await writeSong(song('Two'))
    await mem.write('songs/broken/song.json', '{not json')
    await mem.write('songs/empty/samples/x.bin', new ArrayBuffer(1))
    const list = await listSongs()
    expect(list.map((s) => s.slug).sort()).toEqual(['one', 'two'])
  })

  it('deletes a song with its samples', async () => {
    await writeSong(song('One'))
    await writeSampleData('one', 'abc', new ArrayBuffer(4))
    await deleteSong('one')
    expect(await listSongs()).toEqual([])
    expect(mem.files.size).toBe(0)
  })

  it('moves a renamed song, merging samples already written to the new slug', async () => {
    await writeSong(song('Old'))
    await writeSampleData('old', 'a', new ArrayBuffer(1))
    await writeSampleData('new', 'b', new ArrayBuffer(2))
    await moveSongDir('old', 'new')
    expect(await readSong('old')).toBeNull()
    expect((await listSampleAssets('new')).sort()).toEqual(['a', 'b'])
  })

  it('remembers the recent song', async () => {
    expect(await loadRecent()).toBeNull()
    await saveRecent('one')
    expect(await loadRecent()).toBe('one')
  })

  it('treats recent as absent when there is no storage', async () => {
    setStorage(null)
    await saveRecent('one')
    expect(await loadRecent()).toBeNull()
  })
})

describe('sampleStorage', () => {
  beforeEach(() => setStorage(createMemoryBackend()))

  it('stores, reads, lists and deletes samples by hash', async () => {
    await writeSampleData('s', 'h1', new Uint8Array([1, 2]).buffer)
    expect(new Uint8Array((await readSampleAsset('s', 'h1'))!)).toEqual(new Uint8Array([1, 2]))
    expect(await listSampleAssets('s')).toEqual(['h1'])
    await deleteSampleAsset('s', 'h1')
    expect(await readSampleAsset('s', 'h1')).toBeNull()
    expect(await listSampleAssets('s')).toEqual([])
  })

  it('does not rewrite a hash that is already stored', async () => {
    await writeSampleData('s', 'h', new Uint8Array([1]).buffer)
    await writeSampleData('s', 'h', new Uint8Array([2]).buffer)
    expect(new Uint8Array((await readSampleAsset('s', 'h'))!)).toEqual(new Uint8Array([1]))
  })
})
