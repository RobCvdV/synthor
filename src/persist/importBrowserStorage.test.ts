import { describe, expect, it } from 'vitest'
import { createElectronBackend } from './electronBackend'
import { importStorage } from './importBrowserStorage'
import { createMemoryBackend } from './memoryBackend'

describe('importStorage', () => {
  it('copies songs, samples and the recent marker', async () => {
    const from = createMemoryBackend()
    const to = createMemoryBackend()
    await from.write('songs/a/song.json', 'A')
    await from.write('songs/a/samples/h.bin', new Uint8Array([9]).buffer)
    await from.write('recent', 'a')
    await from.write('unrelated', 'x')

    await importStorage(from, to)

    expect([...to.files.keys()].sort()).toEqual(['recent', 'songs/a/samples/h.bin', 'songs/a/song.json'])
    expect(await to.readText('recent')).toBe('a')
  })

  it('keeps what is already on disk', async () => {
    const from = createMemoryBackend()
    const to = createMemoryBackend()
    await from.write('songs/a/song.json', 'browser')
    await from.write('recent', 'a')
    await to.write('songs/a/song.json', 'disk')
    await to.write('recent', 'b')

    await importStorage(from, to)

    expect(await to.readText('songs/a/song.json')).toBe('disk')
    expect(await to.readText('recent')).toBe('b')
  })

  it('is a no-op for empty browser storage', async () => {
    const to = createMemoryBackend()
    await importStorage(createMemoryBackend(), to)
    expect(to.files.size).toBe(0)
  })
})

describe('createElectronBackend', () => {
  it('converts IPC byte views into standalone ArrayBuffers and forwards writes as bytes', async () => {
    const mem = createMemoryBackend()
    const backing = new Uint8Array([0, 1, 2, 3, 4])
    const backend = createElectronBackend({
      readText: (p) => mem.readText(p),
      readBytes: async () => backing.subarray(1, 4),
      write: async (p, d) => {
        expect(d).toBeInstanceOf(Uint8Array)
        await mem.write(p, (d as Uint8Array).slice().buffer)
      },
      list: (p) => mem.list(p),
      exists: (p) => mem.exists(p),
      remove: (p) => mem.remove(p),
    })

    expect([...new Uint8Array((await backend.readBytes('x'))!)]).toEqual([1, 2, 3])
    await backend.write('f', new Uint8Array([7, 8]).buffer)
    expect([...new Uint8Array((await mem.readBytes('f'))!)]).toEqual([7, 8])
  })
})
