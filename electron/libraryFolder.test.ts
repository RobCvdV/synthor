import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyLibrary, libraryTargetProblem } from './libraryFolder'

describe('libraryTargetProblem', () => {
  const lib = path.resolve('/Users/me/Documents/Synthor')

  it('accepts an unrelated folder', () => {
    expect(libraryTargetProblem(lib, path.resolve('/Users/me/Music/Synthor'))).toBeNull()
    expect(libraryTargetProblem(lib, path.resolve('/Users/me/Documents/SynthorLib'))).toBeNull()
  })

  it('rejects the same folder, a folder inside it, or one containing it', () => {
    expect(libraryTargetProblem(lib, lib + path.sep)).toMatch(/already/)
    expect(libraryTargetProblem(lib, path.join(lib, 'songs'))).toMatch(/inside/)
    expect(libraryTargetProblem(lib, path.resolve('/Users/me'))).toMatch(/contain/)
  })
})

describe('copyLibrary', () => {
  let tmp: string
  const write = async (rel: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true })
    await fs.writeFile(path.join(tmp, rel), text)
  }
  const read = (rel: string) => fs.readFile(path.join(tmp, rel), 'utf8')

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'synthor-move-'))
  })
  afterEach(() => fs.rm(tmp, { recursive: true, force: true }))

  it('copies the library parts, merging without overwriting', async () => {
    await write('old/songs/a/song.json', 'a')
    await write('old/samples/s/sample.json', 's')
    await write('old/songs/.DS_Store', 'x')
    await write('old/recent', 'a')
    await write('old/other.txt', 'not library')
    await write('new/songs/a/song.json', 'kept')
    await write('new/songs/b/song.json', 'b')

    await copyLibrary(path.join(tmp, 'old'), path.join(tmp, 'new'))

    expect(await read('new/songs/a/song.json')).toBe('kept')
    expect(await read('new/songs/b/song.json')).toBe('b')
    expect(await read('new/samples/s/sample.json')).toBe('s')
    expect(await read('new/recent')).toBe('a')
    await expect(read('new/songs/.DS_Store')).rejects.toThrow()
    await expect(read('new/other.txt')).rejects.toThrow()
    expect(await read('old/songs/a/song.json')).toBe('a')
  })
})
