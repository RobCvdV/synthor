// @vitest-environment jsdom
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryBackend } from '../persist/memoryBackend'
import { setStorage } from '../persist/storage'
import { backupLibrary, restoreLibrary } from './libraryLocationActions'

const downloadBlob = vi.hoisted(() => vi.fn())
vi.mock('./download', () => ({ downloadBlob }))
const pickFiles = vi.hoisted(() => vi.fn(async (): Promise<File[]> => []))
vi.mock('./pickFiles', () => ({ pickFiles }))
vi.mock('./songActions', () => ({ saveNow: vi.fn(async () => {}) }))

describe('library backup actions', () => {
  let mem: ReturnType<typeof createMemoryBackend>
  beforeEach(async () => {
    mem = createMemoryBackend()
    setStorage(mem)
    await mem.write('songs/a/song.json', '{}')
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('downloads a dated zip of the library', async () => {
    await backupLibrary(new Date('2026-09-30T08:00:00Z'))
    const [blob, filename] = downloadBlob.mock.calls[0] as [Blob, string]
    expect(filename).toBe('Synthor library 2026-09-30.zip')
    expect(Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))).toContain('songs/a/song.json')
  })

  it('restores a picked backup and reports what happened', async () => {
    await backupLibrary()
    const [blob] = downloadBlob.mock.calls.at(-1) as [Blob]
    setStorage(createMemoryBackend())
    pickFiles.mockResolvedValueOnce([new File([blob], 'backup.zip')])
    expect(await restoreLibrary()).toBe(true)
    expect(window.alert).toHaveBeenLastCalledWith('Restored 1 file.')

    pickFiles.mockResolvedValueOnce([new File(['not a zip'], 'x.zip')])
    expect(await restoreLibrary()).toBe(false)
    expect(window.alert).toHaveBeenLastCalledWith(expect.stringMatching(/^Restore failed/))
    expect(await restoreLibrary()).toBe(false)
  })
})
