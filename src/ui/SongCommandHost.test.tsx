// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { AppCommand, OpenedFile } from '../persist/electronBridge'
import { createMemoryBackend } from '../persist/memoryBackend'
import { setStorage } from '../persist/storage'
import { useSongBrowserStore } from '../state/songBrowserStore'
import { SongCommandHost } from './SongCommandHost'
import { resetStores } from './test/testUtils'

const runAppCommand = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./appCommands', () => ({ runAppCommand }))
const actions = vi.hoisted(() => ({ importSongData: vi.fn(async (_data: ArrayBuffer) => {}), openSavedSong: vi.fn(async (_slug: string) => {}) }))
vi.mock('./songActions', () => actions)

function fakeElectron(pending: OpenedFile[]) {
  const listeners: { menu?: (c: AppCommand) => void; file?: (f: OpenedFile) => void } = {}
  const offMenu = vi.fn()
  Object.assign(window, {
    electronAPI: {
      onMenuCommand: (l: (c: AppCommand) => void) => { listeners.menu = l; return offMenu },
      onFileOpened: (l: (f: OpenedFile) => void) => { listeners.file = l; return () => {} },
      takeOpenedFiles: async () => pending,
    },
  })
  return { listeners, offMenu }
}

const file = (name: string, byte: number): OpenedFile => ({ name, bytes: new Uint8Array([byte]) })

describe('SongCommandHost', () => {
  beforeEach(() => {
    resetStores()
    setStorage(createMemoryBackend())
    useSongBrowserStore.setState({ open: false })
  })
  afterEach(() => { delete (window as { electronAPI?: unknown }).electronAPI })

  it('runs menu commands and unsubscribes on unmount', () => {
    const { listeners, offMenu } = fakeElectron([])
    const { unmount } = render(<SongCommandHost />)
    listeners.menu?.('saveAs')
    expect(runAppCommand).toHaveBeenCalledWith('saveAs')
    unmount()
    expect(offMenu).toHaveBeenCalled()
  })

  it('imports files opened before and after startup, in order', async () => {
    const { listeners } = fakeElectron([file('a.synthor', 1), file('b.synthor', 2)])
    render(<SongCommandHost />)
    await vi.waitFor(() => expect(actions.importSongData).toHaveBeenCalledTimes(2))
    listeners.file?.(file('c.synthor', 3))
    await vi.waitFor(() => expect(actions.importSongData).toHaveBeenCalledTimes(3))
    const bytes = actions.importSongData.mock.calls.map(([buf]) => new Uint8Array(buf)[0])
    expect(bytes).toEqual([1, 2, 3])
  })

  it('shows the Open Song dialog on request and opens the chosen song', async () => {
    render(<SongCommandHost />)
    expect(screen.queryByText('Open Song')).toBeNull()
    act(() => useSongBrowserStore.getState().show())
    expect(await screen.findByText('Open Song')).toBeTruthy()
    act(() => useSongBrowserStore.getState().hide())
    expect(screen.queryByText('Open Song')).toBeNull()
  })
})
