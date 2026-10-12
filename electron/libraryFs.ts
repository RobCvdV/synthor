/** Disk operations for the library folder; every path is confined to the root. */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface LibraryEntry {
  name: string
  kind: 'file' | 'directory'
}

/** Resolves a `/`-separated relative path inside `root`, rejecting anything that escapes it. */
export function resolveInRoot(root: string, rel: string): string {
  const parts = rel.split('/').filter((p) => p !== '')
  for (const p of parts) {
    if (p === '.' || p === '..' || /[\\:\0]/.test(p)) throw new Error(`Invalid storage path: ${rel}`)
  }
  const base = path.resolve(root)
  const full = path.resolve(base, ...parts)
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Invalid storage path: ${rel}`)
  return full
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

/** A cloud placeholder (iCloud "Optimize Mac Storage"): has a size but no local blocks, so reading it waits for a download. */
export function isEvicted(st: { size: number; blocks: number }): boolean {
  return st.size > 0 && st.blocks === 0
}

const PREFETCH_CONCURRENCY = 4

export interface LibraryFsHooks {
  /** A read is waiting for (`true`) or got (`false`) an evicted file's download. */
  onCloudWait?: (rel: string, waiting: boolean) => void
}

export function createLibraryFs(root: string, hooks: LibraryFsHooks = {}) {
  const at = (rel: string) => resolveInRoot(root, rel)

  /** Runs `read`, reporting the wait when the file first has to be downloaded. */
  async function read<T>(rel: string, load: (full: string) => Promise<T>): Promise<T | null> {
    const full = at(rel)
    const st = await orNull(fs.stat(full))
    if (!st) return null
    if (!isEvicted(st) || !hooks.onCloudWait) return orNull(load(full))
    hooks.onCloudWait(rel, true)
    try {
      return await orNull(load(full))
    } finally {
      hooks.onCloudWait(rel, false)
    }
  }

  /** Every evicted file under `dir`, depth first. */
  async function evicted(dir: string): Promise<string[]> {
    const entries = await orNull(fs.readdir(dir, { withFileTypes: true }))
    const found: string[] = []
    for (const e of entries ?? []) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) found.push(...await evicted(full))
      else if (e.isFile()) {
        const st = await orNull(fs.stat(full))
        if (st && isEvicted(st)) found.push(full)
      }
    }
    return found
  }

  return {
    readText: (rel: string) => read(rel, (full) => fs.readFile(full, 'utf8')),

    readBytes: (rel: string) => read(rel, (full) => fs.readFile(full)),

    /** Downloads every evicted file in the background, so later reads don't wait; returns how many. */
    async prefetch(): Promise<number> {
      const queue = await evicted(path.resolve(root))
      const total = queue.length
      const worker = async () => {
        for (let full = queue.shift(); full; full = queue.shift()) {
          await fs.readFile(full).catch((err: unknown) => console.warn('[library] prefetch failed:', full, err))
        }
      }
      await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker))
      return total
    },

    /** Writes via a temp file + rename so a crash never leaves a half-written file. */
    async write(rel: string, data: string | Uint8Array): Promise<void> {
      const full = at(rel)
      if (full === path.resolve(root)) throw new Error('Cannot write to the library root')
      await fs.mkdir(path.dirname(full), { recursive: true })
      const tmp = `${full}.${randomBytes(4).toString('hex')}.tmp`
      try {
        await fs.writeFile(tmp, data)
        await fs.rename(tmp, full)
      } catch (err) {
        await fs.rm(tmp, { force: true })
        throw err
      }
    },

    /** Direct children, skipping dotfiles (.DS_Store, temp files). */
    async list(rel: string): Promise<LibraryEntry[]> {
      const entries = await orNull(fs.readdir(at(rel), { withFileTypes: true }))
      return (entries ?? [])
        .filter((e) => !e.name.startsWith('.') && (e.isFile() || e.isDirectory()))
        .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }))
    },

    async exists(rel: string): Promise<boolean> {
      return (await orNull(fs.stat(at(rel)))) !== null
    },

    async remove(rel: string): Promise<void> {
      const full = at(rel)
      if (full === path.resolve(root)) throw new Error('Refusing to remove the library root')
      await fs.rm(full, { recursive: true, force: true })
    },
  }
}

export type LibraryFs = ReturnType<typeof createLibraryFs>
