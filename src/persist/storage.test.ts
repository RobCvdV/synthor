import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryBackend } from './memoryBackend'
import { copyTree, hasStorage, joinPath, mergeMove, setStorage, splitPath, storage, type StorageBackend } from './storage'

const bytes = (...b: number[]) => new Uint8Array(b).buffer
const names = async (s: StorageBackend, dir: string) => (await s.list(dir)).map((e) => `${e.kind}:${e.name}`).sort()

describe('splitPath / joinPath', () => {
  it('splits on slashes and drops empty segments', () => {
    expect(splitPath('/songs//demo/song.json')).toEqual(['songs', 'demo', 'song.json'])
    expect(splitPath('')).toEqual([])
  })

  it('rejects segments that could escape the root', () => {
    expect(() => splitPath('songs/../secret')).toThrow(/Invalid/)
    expect(() => splitPath('./x')).toThrow(/Invalid/)
    expect(() => splitPath('a\\b')).toThrow(/Invalid/)
  })

  it('joins, skipping empty parts', () => {
    expect(joinPath('songs', '', 'demo')).toBe('songs/demo')
  })
})

describe('active backend', () => {
  it('defaults to none outside a browser, and can be swapped', () => {
    setStorage(undefined as unknown as null)
    expect(hasStorage()).toBe(false)
    const mem = createMemoryBackend()
    setStorage(mem)
    expect(storage()).toBe(mem)
    setStorage(null)
    expect(hasStorage()).toBe(false)
  })
})

// The contract every backend must honour; only the memory one runs under node.
describe('memory backend contract', () => {
  let s: StorageBackend
  beforeEach(() => {
    s = createMemoryBackend()
  })

  it('round-trips text and bytes, creating parents', async () => {
    await s.write('a/b/c.txt', 'hello')
    await s.write('a/d.bin', bytes(1, 2, 3))
    expect(await s.readText('a/b/c.txt')).toBe('hello')
    expect(new Uint8Array((await s.readBytes('a/d.bin'))!)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('returns null for missing files and [] for missing dirs', async () => {
    expect(await s.readText('nope')).toBeNull()
    expect(await s.readBytes('nope/x')).toBeNull()
    expect(await s.list('nope')).toEqual([])
  })

  it('overwrites existing files', async () => {
    await s.write('f', 'one')
    await s.write('f', 'two')
    expect(await s.readText('f')).toBe('two')
  })

  it('does not share buffers with callers', async () => {
    const data = new Uint8Array([7])
    await s.write('f', data.buffer)
    data[0] = 9
    const read = new Uint8Array((await s.readBytes('f'))!)
    read[0] = 5
    expect(new Uint8Array((await s.readBytes('f'))!)[0]).toBe(7)
  })

  it('lists direct children with their kind', async () => {
    await s.write('songs/a/song.json', '{}')
    await s.write('songs/a/samples/x.bin', bytes(1))
    await s.write('songs/b/song.json', '{}')
    await s.write('recent', 'a')
    expect(await names(s, '')).toEqual(['directory:songs', 'file:recent'])
    expect(await names(s, 'songs')).toEqual(['directory:a', 'directory:b'])
    expect(await names(s, 'songs/a')).toEqual(['directory:samples', 'file:song.json'])
  })

  it('reports existence of files and directories', async () => {
    await s.write('d/f', 'x')
    expect(await s.exists('d')).toBe(true)
    expect(await s.exists('d/f')).toBe(true)
    expect(await s.exists('d/g')).toBe(false)
    expect(await s.exists('dx')).toBe(false)
  })

  it('removes files and whole trees, ignoring missing paths', async () => {
    await s.write('d/f', 'x')
    await s.write('d/e/g', 'y')
    await s.write('keep', 'z')
    await s.remove('d/f')
    expect(await s.exists('d/f')).toBe(false)
    await s.remove('d')
    expect(await s.exists('d/e/g')).toBe(false)
    await s.remove('missing')
    expect(await s.readText('keep')).toBe('z')
  })

  it('refuses to remove the root', async () => {
    await expect(s.remove('')).rejects.toThrow(/root/)
  })
})

describe('mergeMove', () => {
  it('moves a tree, keeping files already at the destination', async () => {
    const s = createMemoryBackend()
    await s.write('songs/old/song.json', 'old')
    await s.write('songs/old/samples/a.bin', bytes(1))
    await s.write('songs/new/song.json', 'new')
    await s.write('songs/new/samples/b.bin', bytes(2))

    await mergeMove(s, 'songs/old', 'songs/new')

    expect(await s.exists('songs/old')).toBe(false)
    expect(await s.readText('songs/new/song.json')).toBe('new')
    expect(await names(s, 'songs/new/samples')).toEqual(['file:a.bin', 'file:b.bin'])
  })

  it('copyTree overwrites on request', async () => {
    const a = createMemoryBackend()
    const b = createMemoryBackend()
    await a.write('x/f', 'new')
    await b.write('x/f', 'old')
    await copyTree(a, 'x', b, 'x')
    expect(await b.readText('x/f')).toBe('old')
    await copyTree(a, 'x', b, 'x', true)
    expect(await b.readText('x/f')).toBe('new')
  })

  it('is a no-op when the source is missing', async () => {
    const s = createMemoryBackend()
    await s.write('songs/new/song.json', 'new')
    await mergeMove(s, 'songs/old', 'songs/new')
    expect(await names(s, 'songs')).toEqual(['directory:new'])
  })
})
