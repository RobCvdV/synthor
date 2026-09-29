/** Storage backend on the Electron library folder (~/Documents/Synthor). */
import type { ElectronApi } from './electronBridge'
import type { StorageBackend } from './storage'

/** Copies IPC bytes into a standalone ArrayBuffer (the received view may be offset). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export function createElectronBackend(api: ElectronApi['storage']): StorageBackend {
  return {
    readText: (path) => api.readText(path),
    async readBytes(path) {
      const data = await api.readBytes(path)
      return data ? toArrayBuffer(data) : null
    },
    write: (path, data) => api.write(path, typeof data === 'string' ? data : new Uint8Array(data)),
    list: (path) => api.list(path),
    exists: (path) => api.exists(path),
    remove: (path) => api.remove(path),
  }
}
