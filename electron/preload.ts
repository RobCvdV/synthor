/**
 * Preload script — runs in a sandboxed context with access to a limited set of
 * Node.js APIs via `contextBridge`. The renderer accesses these through
 * `window.electronAPI`.
 */

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  /** The renderer can check this to gate Electron-specific features. */
  platform: 'electron' as const,
})
