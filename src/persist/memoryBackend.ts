/** In-memory storage backend: tests, and a stand-in where nothing persists. */
import { joinPath, splitPath, type StorageBackend, type StorageEntry } from './storage'

export function createMemoryBackend(): StorageBackend & { files: Map<string, ArrayBuffer> } {
  const files = new Map<string, ArrayBuffer>()
  const norm = (path: string) => joinPath(...splitPath(path))
  const isUnder = (file: string, dir: string) => dir === '' || file.startsWith(`${dir}/`)

  return {
    files,

    async readText(path) {
      const data = files.get(norm(path))
      return data ? new TextDecoder().decode(data) : null
    },

    async readBytes(path) {
      const data = files.get(norm(path))
      return data ? data.slice(0) : null
    },

    async write(path, data) {
      const key = norm(path)
      if (!key) throw new Error(`Invalid storage path: ${path}`)
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data.slice(0)
      files.set(key, bytes as ArrayBuffer)
    },

    async list(path) {
      const dir = norm(path)
      const seen = new Map<string, StorageEntry['kind']>()
      for (const key of files.keys()) {
        if (!isUnder(key, dir)) continue
        const rest = splitPath(dir ? key.slice(dir.length + 1) : key)
        seen.set(rest[0], rest.length > 1 ? 'directory' : 'file')
      }
      return [...seen].map(([name, kind]) => ({ name, kind }))
    },

    async exists(path) {
      const p = norm(path)
      return files.has(p) || [...files.keys()].some((k) => isUnder(k, p))
    },

    async remove(path) {
      const p = norm(path)
      if (!p) throw new Error('Refusing to remove the storage root')
      for (const key of [...files.keys()]) {
        if (key === p || isUnder(key, p)) files.delete(key)
      }
    },
  }
}
