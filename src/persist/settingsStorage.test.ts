import { describe, expect, it, vi } from 'vitest'
import { createElectronSettingsStorage } from './settingsStorage'

describe('createElectronSettingsStorage', () => {
  const setup = (store: Record<string, string>, legacy: Record<string, string> = {}) => {
    const setSetting = vi.fn()
    const storage = createElectronSettingsStorage(
      { settingsStore: store, setSetting },
      { getItem: (k) => legacy[k] ?? null },
    )
    return { storage, setSetting }
  }

  it('reads from settings.json first, then carries over localStorage', () => {
    const { storage } = setup({ a: 'disk' }, { a: 'old', b: 'old-b' })
    expect(storage.getItem('a')).toBe('disk')
    expect(storage.getItem('b')).toBe('old-b')
    expect(storage.getItem('c')).toBeNull()
  })

  it('writes through to the main process and reads its own writes', () => {
    const { storage, setSetting } = setup({})
    storage.setItem('a', 'v')
    expect(storage.getItem('a')).toBe('v')
    expect(setSetting).toHaveBeenCalledWith('a', 'v')
    storage.removeItem('a')
    expect(storage.getItem('a')).toBeNull()
    expect(setSetting).toHaveBeenLastCalledWith('a', null)
  })

  it('does not mutate the startup snapshot', () => {
    const snapshot = { a: '1' }
    setup(snapshot).storage.setItem('a', '2')
    expect(snapshot.a).toBe('1')
  })
})
