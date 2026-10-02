// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryBackend } from './memoryBackend'
import { setStorage, storage } from './storage'
import { connectedFolderName, copyLibrary, isFolderAccessSupported, openSavedFolder, type FolderHandle, type HandleStore } from './webFolder'

function fakeHandle(name: string, query: PermissionState, request: PermissionState = 'granted') {
  return {
    name,
    queryPermission: vi.fn(async () => query),
    requestPermission: vi.fn(async () => request),
  } as unknown as FolderHandle & { queryPermission: ReturnType<typeof vi.fn>; requestPermission: ReturnType<typeof vi.fn> }
}

const storeWith = (handle: FolderHandle | null): HandleStore => ({ get: async () => handle, set: async () => {}, clear: async () => {} })

describe('copyLibrary', () => {
  it('copies songs, instruments, samples and recent; the destination wins unless overwriting', async () => {
    const from = createMemoryBackend()
    const to = createMemoryBackend()
    for (const p of ['songs/a/song.json', 'instruments/i/instrument.json', 'samples/s/sample.json', 'recent', 'other/x']) await from.write(p, 'from')
    await to.write('recent', 'to')
    await copyLibrary(from, to)
    expect([...to.files.keys()].sort()).toEqual(['instruments/i/instrument.json', 'recent', 'samples/s/sample.json', 'songs/a/song.json'])
    expect(await to.readText('recent')).toBe('to')
    await copyLibrary(from, to, true)
    expect(await to.readText('recent')).toBe('from')
  })
})

describe('openSavedFolder', () => {
  const browser = createMemoryBackend()
  const folder = createMemoryBackend()
  beforeEach(() => {
    setStorage(browser)
    Object.assign(navigator, { storage: { getDirectory: async () => ({}) } })
    Object.assign(window, { showDirectoryPicker: vi.fn() })
  })
  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
  })

  it('is only offered where the browser supports folders', () => {
    expect(isFolderAccessSupported()).toBe(true)
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
    expect(isFolderAccessSupported()).toBe(false)
  })

  it('uses a folder whose access is still granted, without asking', async () => {
    const ask = vi.fn(async () => true)
    await openSavedFolder(ask, storeWith(fakeHandle('Music', 'granted')), () => folder)
    expect(storage()).toBe(folder)
    expect(connectedFolderName()).toBe('Music')
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks to reconnect when the browser needs a click', async () => {
    const handle = fakeHandle('Music', 'prompt')
    await openSavedFolder(async () => true, storeWith(handle), () => folder)
    expect(handle.requestPermission).toHaveBeenCalled()
    expect(storage()).toBe(folder)
  })

  it('stays on browser storage when declined, denied, or nothing was saved', async () => {
    const declined = fakeHandle('Music', 'prompt')
    await openSavedFolder(async () => false, storeWith(declined), () => folder)
    expect(declined.requestPermission).not.toHaveBeenCalled()
    await openSavedFolder(async () => true, storeWith(fakeHandle('Music', 'prompt', 'denied')), () => folder)
    await openSavedFolder(async () => true, storeWith(fakeHandle('Music', 'denied')), () => folder)
    await openSavedFolder(async () => true, storeWith(null), () => folder)
    expect(storage()).toBe(browser)
  })
})
