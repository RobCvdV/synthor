/**
 * The file-like store every persist module writes through. Paths are
 * `/`-separated and relative to the storage root (e.g. `songs/demo/song.json`);
 * the backend decides where that root lives (OPFS, a disk folder, memory).
 */
import { createOpfsBackend, isOpfsSupported } from './opfsBackend'

export interface StorageEntry {
  name: string
  kind: 'file' | 'directory'
}

export interface StorageBackend {
  /** File contents as text, or null if absent. */
  readText(path: string): Promise<string | null>
  /** File contents as bytes, or null if absent. */
  readBytes(path: string): Promise<ArrayBuffer | null>
  /** Create or overwrite a file, creating parent directories. */
  write(path: string, data: string | ArrayBuffer): Promise<void>
  /** Direct children of a directory; empty if it doesn't exist. */
  list(dir: string): Promise<StorageEntry[]>
  exists(path: string): Promise<boolean>
  /** Delete a file or a directory tree; no-op if absent. */
  remove(path: string): Promise<void>
}

/** Splits a storage path into segments, rejecting ones that could escape the root. */
export function splitPath(path: string): string[] {
  const parts = path.split('/').filter((p) => p !== '')
  for (const p of parts) {
    if (p === '.' || p === '..' || p.includes('\\')) throw new Error(`Invalid storage path: ${path}`)
  }
  return parts
}

export function joinPath(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/')
}

let active: StorageBackend | null | undefined

/** The active backend, or null where no persistent storage exists (tests, old browsers). */
export function storage(): StorageBackend | null {
  if (active === undefined) active = isOpfsSupported() ? createOpfsBackend() : null
  return active
}

export function hasStorage(): boolean {
  return storage() !== null
}

/** Like `storage()`, but throws when there is none. */
export function requireStorage(): StorageBackend {
  const s = storage()
  if (!s) throw new Error('No persistent storage available')
  return s
}

/** Swap the backend (Electron disk folder, tests). */
export function setStorage(backend: StorageBackend | null): void {
  active = backend
}

/** Copies `from` into `to` (existing files at `to` win), then deletes `from`. */
export async function mergeMove(s: StorageBackend, from: string, to: string): Promise<void> {
  if (!await s.exists(from)) return
  await copyTree(s, from, to)
  await s.remove(from)
}

async function copyTree(s: StorageBackend, from: string, to: string): Promise<void> {
  for (const entry of await s.list(from)) {
    const src = joinPath(from, entry.name)
    const dst = joinPath(to, entry.name)
    if (entry.kind === 'directory') {
      await copyTree(s, src, dst)
    } else if (!await s.exists(dst)) {
      const data = await s.readBytes(src)
      if (data) await s.write(dst, data)
    }
  }
}
