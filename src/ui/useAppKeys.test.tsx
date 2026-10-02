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

  it('has no view shortcuts; Cmd+S saves', () => {
    renderHook(() => useAppKeys(stubHost(), player, () => {}))
    for (const code of ['KeyT', 'KeyI', 'KeyE', 'KeyM']) press(code, { metaKey: true })
    expect(useAppStore.getState().view).toBe('tracker')
    press('KeyS', { metaKey: true })
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
