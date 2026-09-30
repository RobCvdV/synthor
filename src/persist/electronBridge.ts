/** The `window.electronAPI` surface exposed by `electron/preload.cts`. */
import type { StorageEntry } from './storage'

/** Menu commands sent by `electron/appMenu.ts`; keep the two lists in sync. */
export type AppCommand = 'newSong' | 'openSong' | 'save' | 'saveAs' | 'importSong' | 'exportSong' | 'revealLibrary'

/** A song file opened from the OS (double-click, Open With). */
export interface OpenedFile {
  name: string
  bytes: Uint8Array
}

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
  /** Returns the unsubscribe. */
  onMenuCommand(listener: (command: AppCommand) => void): () => void
  /** Files opened before the renderer was ready; later ones arrive through `onFileOpened`. */
  takeOpenedFiles(): Promise<OpenedFile[]>
  onFileOpened(listener: (file: OpenedFile) => void): () => void
}

/** The Electron bridge, or null in the browser. */
export function electronApi(): ElectronApi | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI ?? null
}
