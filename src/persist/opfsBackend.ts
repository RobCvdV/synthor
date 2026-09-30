/**
 * Storage backends on File System Access directory handles: the Origin Private
 * File System (always available, private to this origin) or a folder the user
 * picked (Chromium only; see `webFolder.ts`).
 */
import { splitPath, type StorageBackend, type StorageEntry } from './storage'

/** Is OPFS available in this environment? (false in tests / old Safari.) */
export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')
}

/** Dotfiles (.DS_Store) and Chromium's in-progress write swaps aren't library content. */
function isHiddenEntry(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.crswap')
}

type IterableDir = AsyncIterable<[string, FileSystemHandle]>

export function createOpfsBackend(): StorageBackend {
  return createDirectoryBackend(() => navigator.storage.getDirectory())
}

/** A backend rooted at a directory handle. */
export function createDirectoryBackend(getRoot: () => Promise<FileSystemDirectoryHandle>): StorageBackend {
  async function dirAt(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = await getRoot()
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create })
    return dir
  }

  async function fileAt(path: string): Promise<File | null> {
    const parts = splitPath(path)
    const name = parts.pop()
    if (!name) return null
    try {
      const dir = await dirAt(parts, false)
      return await (await dir.getFileHandle(name)).getFile()
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  return {
    async readText(path) {
      return (await fileAt(path))?.text() ?? null
    },

    async readBytes(path) {
      return (await fileAt(path))?.arrayBuffer() ?? null
    },

    async write(path, data) {
      const parts = splitPath(path)
      const name = parts.pop()
      if (!name) throw new Error(`Invalid storage path: ${path}`)
      const dir = await dirAt(parts, true)
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
      try {
        await writable.write(data)
      } finally {
        await writable.close()
      }
    },

    async list(path) {
      let dir: FileSystemDirectoryHandle
      try {
        dir = await dirAt(splitPath(path), false)
      } catch (err) {
        if (isNotFound(err)) return []
        throw err
      }
      const out: StorageEntry[] = []
      // The DOM typings lag behind: directory handles are async-iterable.
      for await (const [name, handle] of dir as unknown as IterableDir) {
        if (!isHiddenEntry(name)) out.push({ name, kind: handle.kind })
      }
      return out
    },

    async exists(path) {
      const parts = splitPath(path)
      const name = parts.pop()
      if (!name) return true
      try {
        const dir = await dirAt(parts, false)
        for await (const [n] of dir as unknown as IterableDir) {
          if (n === name) return true
        }
        return false
      } catch (err) {
        if (isNotFound(err)) return false
        throw err
      }
    },

    async remove(path) {
      const parts = splitPath(path)
      const name = parts.pop()
      if (!name) throw new Error('Refusing to remove the storage root')
      try {
        const dir = await dirAt(parts, false)
        await dir.removeEntry(name, { recursive: true })
      } catch (err) {
        if (!isNotFound(err)) throw err
      }
    },
  }
}
