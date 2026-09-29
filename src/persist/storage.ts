/**
 * The file-like store every persist module writes through. Paths are
 * `/`-separated and relative to the storage root (e.g. `songs/demo/song.json`);
 * the backend decides where that root lives (OPFS, a disk folder, memory).
 */
import { createElectronBackend } from './electronBackend'
import { electronApi } from './electronBridge'
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

function defaultBackend(): StorageBackend | null {
  const api = electronApi()
  if (api) return createElectronBackend(api.storage)
  return isOpfsSupported() ? createOpfsBackend() : null
}

/** The active backend, or null where no persistent storage exists (tests, old browsers). */
export function storage(): StorageBackend | null {
  if (active === undefined) active = defaultBackend()
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
  await copyTree(s, from, s, to)
  await s.remove(from)
}

/** Copies a tree between (possibly different) backends; existing files at the destination win. */
export async function copyTree(src: StorageBackend, from: string, dst: StorageBackend, to: string): Promise<void> {
  for (const entry of await src.list(from)) {
    const srcPath = joinPath(from, entry.name)
    const dstPath = joinPath(to, entry.name)
    if (entry.kind === 'directory') {
      await copyTree(src, srcPath, dst, dstPath)
    } else if (!await dst.exists(dstPath)) {
      const data = await src.readBytes(srcPath)
      if (data) await dst.write(dstPath, data)
    }
  }
}
