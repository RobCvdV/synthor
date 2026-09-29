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
  },

  setSetting: (key: string, value: string | null) => ipcRenderer.send('settings:setItem', key, value),
  markBrowserStorageImported: (origin: string) => ipcRenderer.invoke('settings:markBrowserStorageImported', origin),
  revealLibrary: () => ipcRenderer.invoke('library:reveal'),
})
