import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibraryFs, isEvicted, resolveInRoot, type LibraryFs } from './libraryFs'

describe('resolveInRoot', () => {
  const root = path.resolve('/lib')

  it('resolves relative paths inside the root', () => {
    expect(resolveInRoot(root, 'songs/a/song.json')).toBe(path.join(root, 'songs', 'a', 'song.json'))
    expect(resolveInRoot(root, '')).toBe(root)
  })

  it('rejects traversal, separators and drive letters', () => {
    for (const bad of ['../x', 'songs/../../x', './x', 'a\\b', 'C:', 'a\0b']) {
      expect(() => resolveInRoot(root, bad), bad).toThrow(/Invalid/)
    }
  })
})

describe('createLibraryFs', () => {
  let root: string
  let lib: LibraryFs

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synthor-lib-'))
    lib = createLibraryFs(root)
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it('writes text and bytes, creating parents, without leaving temp files', async () => {
    await lib.write('songs/a/song.json', '{"x":1}')
    await lib.write('songs/a/samples/h.bin', new Uint8Array([1, 2, 3]))
    expect(await lib.readText('songs/a/song.json')).toBe('{"x":1}')
    expect([...(await lib.readBytes('songs/a/samples/h.bin'))!]).toEqual([1, 2, 3])
    expect(await fs.readdir(path.join(root, 'songs', 'a'))).toEqual(['samples', 'song.json'])
  })

  it('overwrites existing files', async () => {
    await lib.write('f', 'one')
    await lib.write('f', 'two')
    expect(await lib.readText('f')).toBe('two')
  })

  it('returns null / [] / false for missing paths', async () => {
    expect(await lib.readText('nope')).toBeNull()
    expect(await lib.readBytes('nope/x')).toBeNull()
    expect(await lib.list('nope')).toEqual([])
    expect(await lib.exists('nope')).toBe(false)
  })

  it('treats a file as an empty directory when listed', async () => {
    await lib.write('recent', 'a')
    expect(await lib.list('recent')).toEqual([])
    expect(await lib.readText('recent/x')).toBeNull()
  })

  it('lists children with kinds and skips dotfiles', async () => {
    await lib.write('songs/a/song.json', '{}')
    await lib.write('songs/b.txt', 'x')
    await fs.writeFile(path.join(root, 'songs', '.DS_Store'), '')
    const entries = (await lib.list('songs')).sort((x, y) => x.name.localeCompare(y.name))
    expect(entries).toEqual([
      { name: 'a', kind: 'directory' },
      { name: 'b.txt', kind: 'file' },
    ])
  })

  it('removes files and trees, ignoring missing paths', async () => {
    await lib.write('songs/a/song.json', '{}')
    await lib.remove('songs/a/song.json')
    expect(await lib.exists('songs/a/song.json')).toBe(false)
    await lib.remove('songs')
    expect(await lib.exists('songs')).toBe(false)
    await lib.remove('missing')
  })

  it('refuses to write or remove the root itself', async () => {
    await expect(lib.write('', 'x')).rejects.toThrow(/root/)
    await expect(lib.remove('')).rejects.toThrow(/root/)
  })
})

describe('evicted (cloud placeholder) files', () => {
  let root: string
  // Real placeholders need iCloud; fake one by reporting no allocated blocks for its path.
  const placeholders = new Set<string>()

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synthor-lib-'))
    const stat = fs.stat.bind(fs)
    vi.spyOn(fs, 'stat').mockImplementation((async (p: string) => {
      const st = await stat(p)
      return placeholders.has(p) ? Object.assign(st, { blocks: 0 }) : st
    }) as typeof fs.stat)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    placeholders.clear()
    await fs.rm(root, { recursive: true, force: true })
  })

  const placeholder = async (rel: string, text: string) => {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, text)
    placeholders.add(full)
  }

  it('recognises a placeholder by its missing blocks', () => {
    expect(isEvicted({ size: 200, blocks: 0 })).toBe(true)
    expect(isEvicted({ size: 200, blocks: 8 })).toBe(false)
    expect(isEvicted({ size: 0, blocks: 0 })).toBe(false)
  })

  it('reports the wait around reading a placeholder, and only then', async () => {
    const waits: [string, boolean][] = []
    const lib = createLibraryFs(root, { onCloudWait: (rel, waiting) => waits.push([rel, waiting]) })
    await placeholder('songs/a/song.json', 'cloud')
    await fs.writeFile(path.join(root, 'local.txt'), 'here')

    expect(await lib.readText('songs/a/song.json')).toBe('cloud')
    expect(await lib.readText('local.txt')).toBe('here')
    expect(await lib.readBytes('missing.bin')).toBeNull()
    expect(waits).toEqual([['songs/a/song.json', true], ['songs/a/song.json', false]])
  })

  it('prefetches every placeholder, skipping local and hidden files', async () => {
    await placeholder('songs/a/song.json', 'a')
    await placeholder('songs/a/samples/h.bin', 'h')
    await placeholder('.hidden/x', 'x')
    await fs.writeFile(path.join(root, 'local.txt'), 'here')
    const read = vi.spyOn(fs, 'readFile')

    expect(await createLibraryFs(root).prefetch()).toBe(2)
    expect(read.mock.calls.map(([p]) => path.relative(root, String(p))).sort())
      .toEqual([path.join('songs', 'a', 'samples', 'h.bin'), path.join('songs', 'a', 'song.json')])
  })
})
