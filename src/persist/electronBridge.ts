/** The `window.electronAPI` surface exposed by `electron/preload.cts`. */
import type { StorageEntry } from './storage'

export interface ElectronApi {
  platform: 'electron'
  /** Absolute path of the library folder on disk. */
  libraryPath: string
  /** Origins whose browser-storage songs were already copied to the library. */
  importedBrowserOrigins: string[]
  /** The renderer key-value store as loaded at startup. */
  settingsStore: Record<string, string>
  storage: {
    readText(path: string): Promise<string | null>
    readBytes(path: string): Promise<Uint8Array | null>
    write(path: string, data: string | Uint8Array): Promise<void>
    list(path: string): Promise<StorageEntry[]>
    exists(path: string): Promise<boolean>
    remove(path: string): Promise<void>
  }
  setSetting(key: string, value: string | null): void
  markBrowserStorageImported(origin: string): Promise<void>
  revealLibrary(): Promise<string>
}

/** The Electron bridge, or null in the browser. */
export function electronApi(): ElectronApi | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI ?? null
}
