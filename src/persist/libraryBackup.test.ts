import { strToU8, unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportLibraryZip, restoreLibraryZip } from './libraryBackup'
import { createMemoryBackend } from './memoryBackend'

const bytes = (...b: number[]) => new Uint8Array(b).buffer

describe('library backup', () => {
  let src: ReturnType<typeof createMemoryBackend>
  beforeEach(async () => {
    src = createMemoryBackend()
    await src.write('songs/a/song.json', '{"a":1}')
    await src.write('songs/a/samples/h.bin', bytes(1, 2))
    await src.write('instruments/pad/instrument.json', '{}')
    await src.write('samples/kick/kick.wav', bytes(3))
    await src.write('recent', 'a')
  })

  it('zips songs, instruments and samples with a manifest, leaving out app state', async () => {
    const zip = await exportLibraryZip(src, new Date('2026-09-30T12:00:00Z'))
    const entries = unzipSync(zip)
    expect(Object.keys(entries).sort()).toEqual([
      'instruments/pad/instrument.json', 'samples/kick/kick.wav', 'songs/a/samples/h.bin', 'songs/a/song.json', 'synthor-library.json',
    ])
    expect(JSON.parse(new TextDecoder().decode(entries['synthor-library.json']))).toEqual({
      format: 'synthor-library', version: 1, createdAt: '2026-09-30T12:00:00.000Z', files: 4,
    })
  })

  it('restores into empty storage', async () => {
    const dst = createMemoryBackend()
    expect(await restoreLibraryZip(dst, await exportLibraryZip(src))).toEqual({ added: 4, kept: 0 })
    expect(await dst.readText('songs/a/song.json')).toBe('{"a":1}')
    expect([...new Uint8Array((await dst.readBytes('samples/kick/kick.wav'))!)]).toEqual([3])
  })

  it('merges, keeping files that already exist', async () => {
    const dst = createMemoryBackend()
    await dst.write('songs/a/song.json', '{"mine":true}')
    await dst.write('songs/b/song.json', '{}')
    expect(await restoreLibraryZip(dst, await exportLibraryZip(src))).toEqual({ added: 3, kept: 1 })
    expect(await dst.readText('songs/a/song.json')).toBe('{"mine":true}')
    expect(await dst.exists('songs/b/song.json')).toBe(true)
  })

  it('rejects other zips and skips entries outside the library', async () => {
    const dst = createMemoryBackend()
    await expect(restoreLibraryZip(dst, zipSync({ 'song.json': strToU8('{}') }))).rejects.toThrow(/Not a Synthor library/)
    const sneaky = zipSync({
      'synthor-library.json': strToU8('{"format":"synthor-library","version":1}'),
      'recent': strToU8('x'),
      'songs/../../evil': strToU8('x'),
      'other/file': strToU8('x'),
      'songs/ok/song.json': strToU8('{}'),
    })
    expect(await restoreLibraryZip(dst, sneaky)).toEqual({ added: 1, kept: 0 })
    expect([...dst.files.keys()]).toEqual(['songs/ok/song.json'])
  })
})
