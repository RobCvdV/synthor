// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppKeys } from './useAppKeys'
import { resetStores, stubHost } from './test/testUtils'
import { useAppStore } from '../state/appStore'
import type { KeyboardPlayer } from '../audio/keyboardPlayer'

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
})
