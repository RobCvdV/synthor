/** Key-value storage for persisted UI state: settings.json in Electron, localStorage on the web. */
import type { StateStorage } from 'zustand/middleware'
import { electronApi, type ElectronApi } from './electronBridge'

type Bridge = Pick<ElectronApi, 'settingsStore' | 'setSetting'>

/** Electron storage; keys not yet in settings.json fall back to `legacy` once, so old prefs carry over. */
export function createElectronSettingsStorage(api: Bridge, legacy: Pick<Storage, 'getItem'> | null): StateStorage {
  const store = { ...api.settingsStore }
  return {
    getItem: (name) => store[name] ?? legacy?.getItem(name) ?? null,
    setItem(name, value) {
      store[name] = value
      api.setSetting(name, value)
    },
    removeItem(name) {
      delete store[name]
      api.setSetting(name, null)
    },
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const noStorage: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

/** The settings storage for this environment. */
export function settingsStorage(): StateStorage {
  const api = electronApi()
  if (api) return createElectronSettingsStorage(api, localStorageOrNull())
  return localStorageOrNull() ?? noStorage
}
