import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLibrary, withTimeout, type LibrarySettings } from './libraryLocation'

describe('resolveLibrary', () => {
  let tmp: string
  let local: string
  let icloud: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'synthor-loc-'))
    local = path.join(tmp, 'Documents', 'Synthor')
    icloud = path.join(tmp, 'iCloud', 'Documents')
    await fs.mkdir(icloud, { recursive: true })
  })
  afterEach(() => fs.rm(tmp, { recursive: true, force: true }))

  const resolve = (settings: LibrarySettings, icloudDocs: string | null, copy = vi.fn(async () => {})) => {
    const update = vi.fn()
    return { update, copy, result: resolveLibrary({ settings, icloudDocs: Promise.resolve(icloudDocs), localDefault: local, update, copy }) }
  }

  it('keeps a folder the user chose', async () => {
    const { result, copy } = resolve({ libraryPath: '/Music/Synthor', icloudLibrary: true }, icloud)
    expect(await result).toEqual({ path: '/Music/Synthor', kind: 'custom' })
    expect(copy).not.toHaveBeenCalled()
  })

  it('moves an existing local library into iCloud Drive once, and says so', async () => {
    await fs.mkdir(path.join(local, 'songs', 'a'), { recursive: true })
    const { result, copy, update } = resolve({}, icloud)
    const loc = await result
    expect(loc).toMatchObject({ path: icloud, kind: 'icloud', notice: { kind: 'info' } })
    expect(copy).toHaveBeenCalledWith(local, icloud)
    expect(update).toHaveBeenCalledWith({ icloudLibrary: true })
  })

  it('starts a new library in iCloud Drive without copying or a notice', async () => {
    await fs.mkdir(path.join(local, 'songs'), { recursive: true })
    await fs.writeFile(path.join(local, 'songs', '.DS_Store'), '')
    const { result, copy, update } = resolve({}, icloud)
    expect(await result).toEqual({ path: icloud, kind: 'icloud', notice: undefined })
    expect(copy).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ icloudLibrary: true })
  })

  it('uses iCloud Drive directly after the move', async () => {
    await fs.mkdir(path.join(local, 'songs', 'a'), { recursive: true })
    const { result, copy } = resolve({ icloudLibrary: true }, icloud)
    expect(await result).toEqual({ path: icloud, kind: 'icloud' })
    expect(copy).not.toHaveBeenCalled()
  })

  it('falls back to the local library, warning only when the library had moved to iCloud', async () => {
    expect(await resolve({}, null).result).toEqual({ path: local, kind: 'local', notice: undefined })
    expect(await resolve({ icloudLibrary: true }, null).result).toMatchObject({ path: local, kind: 'local', notice: { kind: 'warn' } })
  })

  it('stays local and retries next time when the copy fails', async () => {
    await fs.mkdir(path.join(local, 'instruments', 'x'), { recursive: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, update } = resolve({}, icloud, vi.fn(async () => { throw new Error('disk full') }))
    expect(await result).toMatchObject({ path: local, kind: 'local', notice: { kind: 'warn' } })
    expect(update).not.toHaveBeenCalled()
  })
})

describe('withTimeout', () => {
  it('gives the fallback when the promise is too slow', async () => {
    expect(await withTimeout(new Promise(() => {}), 10, 'late')).toBe('late')
    expect(await withTimeout(Promise.resolve('on time'), 1000, 'late')).toBe('on time')
  })
})
