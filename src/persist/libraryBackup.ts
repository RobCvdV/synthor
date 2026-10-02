/**
 * Whole-library backup: songs, instruments and samples in one zip, plus a
 * small manifest. Restoring merges — files already in storage are kept.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { joinPath, splitPath, type StorageBackend } from './storage'

export const LIBRARY_ROOTS = ['songs', 'instruments', 'samples'] as const
const MANIFEST = 'synthor-library.json'
const FORMAT = 'synthor-library'

async function collectFiles(s: StorageBackend, dir: string, out: string[]): Promise<void> {
  for (const entry of await s.list(dir)) {
    const path = joinPath(dir, entry.name)
    if (entry.kind === 'directory') await collectFiles(s, path, out)
    else out.push(path)
  }
}

/** Every song, instrument and sample file in storage, zipped. */
export async function exportLibraryZip(s: StorageBackend, now = new Date()): Promise<Uint8Array> {
  const paths: string[] = []
  for (const root of LIBRARY_ROOTS) await collectFiles(s, root, paths)
  const files: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(JSON.stringify({ format: FORMAT, version: 1, createdAt: now.toISOString(), files: paths.length })),
  }
  for (const path of paths) {
    const data = await s.readBytes(path)
    if (data) files[path] = new Uint8Array(data)
  }
  // Audio barely compresses; stored entries keep big libraries fast.
  return zipSync(files, { level: 0 })
}

export interface RestoreResult {
  added: number
  /** Already present, left untouched. */
  kept: number
}

/** Adds the backup's files that storage lacks; existing files win. Rejects zips that aren't library backups. */
export async function restoreLibraryZip(s: StorageBackend, zip: Uint8Array): Promise<RestoreResult> {
  const entries = unzipSync(zip)
  const manifest = entries[MANIFEST] ? JSON.parse(strFromU8(entries[MANIFEST])) : null
  if (manifest?.format !== FORMAT) throw new Error('Not a Synthor library backup')

  const result: RestoreResult = { added: 0, kept: 0 }
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    let parts: string[]
    try {
      parts = splitPath(path)
    } catch {
      continue
    }
    if (parts.length < 2 || !(LIBRARY_ROOTS as readonly string[]).includes(parts[0])) continue
    const clean = joinPath(...parts)
    if (await s.exists(clean)) {
      result.kept++
      continue
    }
    await s.write(clean, bytes.slice().buffer as ArrayBuffer)
    result.added++
  }
  return result
}
