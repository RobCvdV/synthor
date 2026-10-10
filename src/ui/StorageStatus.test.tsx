// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setStorage, storage, trackReads } from '../persist/storage'
import { createMemoryBackend } from '../persist/memoryBackend'
import { useStorageStatus, type StorageWait } from '../state/storageStatus'
import { StorageStatus, storageWaitMessage } from './StorageStatus'

const wait = (cloud: boolean): StorageWait => ({ path: 'songs/a/song.json', since: 0, reads: 1, cloud })

describe('storageWaitMessage', () => {
  it('stays quiet for quick reads', () => {
    expect(storageWaitMessage(wait(true), 1, 900)).toBeNull()
  })

  it('names the file, the iCloud download and the time waited', () => {
    expect(storageWaitMessage(wait(true), 1, 3200)).toEqual({ unavailable: false, text: 'Downloading songs/a/song.json from iCloud… 3 s' })
    expect(storageWaitMessage(wait(false), 3, 1000)?.text).toBe('Waiting for the library to deliver songs/a/song.json and 2 more… 1 s')
  })

  it('calls the library unavailable after a long wait', () => {
    const cloud = storageWaitMessage(wait(true), 1, 25_000)
    expect(cloud?.unavailable).toBe(true)
    expect(cloud?.text).toMatch(/^The library isn't available: iCloud hasn't delivered songs\/a\/song.json after 25 s/)
    expect(storageWaitMessage(wait(false), 1, 25_000)?.text).toMatch(/folder is reachable/)
  })
})

describe('StorageStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStorageStatus.setState({ waits: {} })
  })
  afterEach(() => {
    vi.useRealTimers()
    setStorage(null)
    delete (window as { electronAPI?: unknown }).electronAPI
  })

  it('shows a slow read, marks it as an iCloud download, and offers the folder once unavailable', async () => {
    let cloudWait: (w: { path: string; waiting: boolean }) => void = () => {}
    const revealLibrary = vi.fn(async () => '')
    Object.assign(window, { electronAPI: { revealLibrary, storage: { onCloudWait: (l: typeof cloudWait) => { cloudWait = l; return () => {} } } } })
    let deliver: (text: string | null) => void = () => {}
    const mem = createMemoryBackend()
    setStorage(trackReads({ ...mem, readText: () => new Promise((r) => { deliver = r }) }))

    const { container } = render(<StorageStatus />)
    let read!: Promise<string | null>
    act(() => {
      read = storage()!.readText('songs/a/song.json')
      cloudWait({ path: 'songs/a/song.json', waiting: true })
    })
    expect(container.innerHTML).toBe('')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('status').textContent).toBe('Downloading songs/a/song.json from iCloud… 2 s')

    act(() => { vi.advanceTimersByTime(20_000) })
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.click(screen.getByText('Show Library Folder'))
    expect(revealLibrary).toHaveBeenCalled()

    await act(async () => {
      deliver('{}')
      await read
    })
    expect(container.innerHTML).toBe('')
  })

  it('shows the launch notice about the library until dismissed', () => {
    Object.assign(window, { electronAPI: { libraryNotice: { kind: 'info', text: 'Your library now lives in iCloud Drive › Synthor.' }, storage: { onCloudWait: () => () => {} } } })
    const { container } = render(<StorageStatus />)
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.click(screen.getByText('Dismiss'))
    expect(container.innerHTML).toBe('')
  })
})
