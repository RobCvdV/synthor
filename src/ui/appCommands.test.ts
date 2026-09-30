import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSongBrowserStore } from '../state/songBrowserStore'
import { fileShortcut, runAppCommand } from './appCommands'

const actions = vi.hoisted(() => ({
  createNewSong: vi.fn(async () => {}),
  exportCurrentSong: vi.fn(async () => {}),
  importSongFromPicker: vi.fn(async () => {}),
  saveCurrentSongAs: vi.fn(async () => {}),
  saveNow: vi.fn(async () => {}),
}))
vi.mock('./songActions', () => actions)

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })

describe('fileShortcut', () => {
  it('maps ⌘/Ctrl S, ⇧S and O', () => {
    expect(fileShortcut(key('KeyS', { metaKey: true }))).toBe('save')
    expect(fileShortcut(key('KeyS', { ctrlKey: true, shiftKey: true }))).toBe('saveAs')
    expect(fileShortcut(key('KeyO', { metaKey: true }))).toBe('openSong')
  })

  it('ignores other combinations', () => {
    expect(fileShortcut(key('KeyS'))).toBeNull()
    expect(fileShortcut(key('KeyS', { metaKey: true, altKey: true }))).toBeNull()
    expect(fileShortcut(key('KeyO', { metaKey: true, shiftKey: true }))).toBeNull()
    expect(fileShortcut(key('KeyN', { metaKey: true }))).toBeNull()
  })
})

describe('runAppCommand', () => {
  beforeEach(() => useSongBrowserStore.setState({ open: false }))

  it('dispatches each command', async () => {
    await runAppCommand('newSong')
    await runAppCommand('save')
    await runAppCommand('saveAs')
    await runAppCommand('importSong')
    await runAppCommand('exportSong')
    for (const fn of Object.values(actions)) expect(fn).toHaveBeenCalledTimes(1)
    await runAppCommand('openSong')
    expect(useSongBrowserStore.getState().open).toBe(true)
  })

  it('reveals the library only in Electron', async () => {
    await runAppCommand('revealLibrary')
    const revealLibrary = vi.fn(async () => '')
    Object.assign(globalThis, { window: { electronAPI: { revealLibrary } } })
    try {
      await runAppCommand('revealLibrary')
      expect(revealLibrary).toHaveBeenCalled()
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  })
})
