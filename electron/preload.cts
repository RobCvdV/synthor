/**
 * Preload script — exposes `window.electronAPI` to the renderer. CommonJS
 * (`.cts` → `.cjs`) because Electron ignores `"type": "module"` for preloads.
 * The renderer-side contract is `src/persist/electronBridge.ts`.
 */

import electron = require('electron')

const { contextBridge, ipcRenderer } = electron

const settings = ipcRenderer.sendSync('settings:load') as {
  libraryPath: string
  importedBrowserOrigins: string[]
  store: Record<string, string>
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: 'electron' as const,
  libraryPath: settings.libraryPath,
  importedBrowserOrigins: settings.importedBrowserOrigins,
  settingsStore: settings.store,

  storage: {
    readText: (path: string) => ipcRenderer.invoke('storage:readText', path),
    readBytes: (path: string) => ipcRenderer.invoke('storage:readBytes', path),
    write: (path: string, data: string | Uint8Array) => ipcRenderer.invoke('storage:write', path, data),
    list: (path: string) => ipcRenderer.invoke('storage:list', path),
    exists: (path: string) => ipcRenderer.invoke('storage:exists', path),
    remove: (path: string) => ipcRenderer.invoke('storage:remove', path),
    onCloudWait: (listener: (wait: { path: string; waiting: boolean }) => void) => subscribe('storage:cloudWait', listener),
  },

  setSetting: (key: string, value: string | null) => ipcRenderer.send('settings:setItem', key, value),
  markBrowserStorageImported: (origin: string) => ipcRenderer.invoke('settings:markBrowserStorageImported', origin),
  revealLibrary: () => ipcRenderer.invoke('library:reveal'),
  changeLibraryFolder: () => ipcRenderer.invoke('library:change'),

  onMenuCommand: (listener: (command: string) => void) => subscribe('menu:command', listener),
  takeOpenedFiles: () => ipcRenderer.invoke('files:take'),
  onFileOpened: (listener: (file: { name: string; bytes: Uint8Array }) => void) => subscribe('files:open', listener),

  pendingUpdate: () => ipcRenderer.invoke('update:pending'),
  onUpdateDownloaded: (listener: (version: string | null) => void) => subscribe('update:downloaded', listener),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onSaveBeforeQuit: (save: () => Promise<void>) => subscribe('app:save-before-quit', () => {
    void save().catch(() => {}).finally(() => ipcRenderer.send('app:saved'))
  }),
})

/** Forwards a main-process channel to `listener`; returns the unsubscribe. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}
