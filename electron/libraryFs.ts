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

export function createLibraryFs(root: string) {
  const at = (rel: string) => resolveInRoot(root, rel)

  return {
    readText: (rel: string) => orNull(fs.readFile(at(rel), 'utf8')),

    readBytes: (rel: string) => orNull(fs.readFile(at(rel))),

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
