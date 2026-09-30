// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppKeys } from './useAppKeys'
import { resetStores, stubHost } from './test/testUtils'
import { useAppStore } from '../state/appStore'
import type { KeyboardPlayer } from '../audio/keyboardPlayer'

const runAppCommand = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./appCommands', async (orig) => ({ ...(await orig<object>()), runAppCommand }))

const player = { noteOn: vi.fn(), noteOff: vi.fn(), clearHeld: vi.fn() } as unknown as KeyboardPlayer
const press = (code: string, mods: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { code, ...mods }))

describe('useAppKeys', () => {
  beforeEach(resetStores)

  it('changes the octave once per key press', () => {
    renderHook(() => useAppKeys(stubHost(), player, () => {}))
    const octave = useAppStore.getState().octave
    press('Equal')
    expect(useAppStore.getState().octave).toBe(octave + 1)
  })

  it('passes other keys to the tracker only in the tracker view', () => {
    const onTrackerKey = vi.fn()
    renderHook(() => useAppKeys(stubHost(), player, onTrackerKey))
    press('KeyQ')
    expect(onTrackerKey).toHaveBeenCalledTimes(1)

    useAppStore.setState({ view: 'mixer' })
    press('KeyQ')
    expect(onTrackerKey).toHaveBeenCalledTimes(1)
  })

  it('switches views with Cmd+letter', () => {
    renderHook(() => useAppKeys(stubHost(), player, () => {}))
    press('KeyM', { metaKey: true })
    expect(useAppStore.getState().view).toBe('mixer')
  })

  it('opens Samples with Cmd+E, leaving Cmd+S to Save', () => {
    renderHook(() => useAppKeys(stubHost(), player, () => {}))
    press('KeyE', { metaKey: true })
    expect(useAppStore.getState().view).toBe('samples')
    useAppStore.setState({ view: 'tracker' })
    press('KeyS', { metaKey: true })
    expect(useAppStore.getState().view).toBe('tracker')
    expect(runAppCommand).toHaveBeenLastCalledWith('save')
  })

  it('handles file shortcuts on the web only', () => {
    runAppCommand.mockClear()
    renderHook(() => useAppKeys(stubHost(), player, () => {}))
    press('KeyO', { ctrlKey: true })
    expect(runAppCommand).toHaveBeenLastCalledWith('openSong')
    Object.assign(window, { electronAPI: { platform: 'electron' } })
    try {
      press('KeyS', { metaKey: true, shiftKey: true })
      expect(runAppCommand).toHaveBeenCalledTimes(1)
    } finally {
      delete (window as { electronAPI?: unknown }).electronAPI
    }
  })
})
