import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { unpackSongBundle } from './songBundle'
import { makeSongFile, serializeSong } from './serialize'
import { createDefaultDoc } from '../domain/factory'

const META = { name: 'Theme', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' }

describe('unpackSongBundle', () => {
  const doc = createDefaultDoc()
  const json = serializeSong(makeSongFile(doc, META))

  it('reads song.json and the sample binaries of a .synthor zip, keyed by hash', () => {
    const zip = zipSync({
      'song.json': strToU8(json),
      'samples/ab12.bin': new Uint8Array([1, 2, 3]),
      'samples/notahash.txt': new Uint8Array([9]),
    })
    const { file, samples } = unpackSongBundle(zip.buffer as ArrayBuffer)
    expect(file.meta.name).toBe('Theme')
    expect(file.doc.patternId).toBe(doc.patternId)
    expect([...samples.keys()]).toEqual(['ab12'])
    expect([...new Uint8Array(samples.get('ab12')!)]).toEqual([1, 2, 3])
  })

  it('reads a plain JSON song without samples', () => {
    const { file, samples } = unpackSongBundle(strToU8(json))
    expect(file.meta.name).toBe('Theme')
    expect(samples.size).toBe(0)
  })

  it('rejects a zip without song.json', () => {
    expect(() => unpackSongBundle(zipSync({ 'other.json': strToU8('{}') }))).toThrow(/missing song.json/)
  })
})
