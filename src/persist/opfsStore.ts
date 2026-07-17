/**
 * OPFS-backed song store. The Origin Private File System gives us a real,
 * file-like, always-available (Chrome/Edge/Firefox/Safari) working store with
 * no permission prompt — ideal for continuous autosave.
 *
 * Layout mirrors the eventual on-disk project folder so a real File System
 * Access directory (Chromium) or a zip export can reuse it verbatim later:
 *
 *   songs/
 *     <slug>/
 *       song.json      ← the SongFile
 *       samples/       ← (future) content-addressed binary assets
 *
 * The human name lives inside `song.json`'s meta; the directory is a sanitized
 * slug so arbitrary titles are safe as folder names.
 */
import { deserializeSong, serializeSong, type SongFile } from './serialize'

const SONGS_DIR = 'songs'
const SONG_FILE = 'song.json'

/** Is OPFS available in this environment? (false in tests / old Safari.) */
export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

/** Sanitize a display name into a safe directory slug. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

async function songsDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(SONGS_DIR, { create })
}

/** Write (create or overwrite) a song under its slug. */
export async function writeSong(file: SongFile, slug = slugify(file.meta.name)): Promise<string> {
  const dir = await songsDir(true)
  const songDir = await dir.getDirectoryHandle(slug, { create: true })
  const handle = await songDir.getFileHandle(SONG_FILE, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(serializeSong(file))
  } finally {
    await writable.close()
  }
  return slug
}

/** Read a song by slug, or null if it doesn't exist. */
export async function readSong(slug: string): Promise<SongFile | null> {
  try {
    const dir = await songsDir(false)
    const songDir = await dir.getDirectoryHandle(slug)
    const handle = await songDir.getFileHandle(SONG_FILE)
    const text = await (await handle.getFile()).text()
    return deserializeSong(text)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** List every stored song's slug + metadata, skipping unreadable entries. */
export async function listSongs(): Promise<Array<{ slug: string; meta: SongFile['meta'] }>> {
  const out: Array<{ slug: string; meta: SongFile['meta'] }> = []
  let dir: FileSystemDirectoryHandle
  try {
    dir = await songsDir(false)
  } catch (err) {
    if (isNotFound(err)) return out
    throw err
  }
  // `entries()` is an async iterator on directory handles.
  for await (const [slug, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== 'directory') continue
    const file = await readSong(slug).catch(() => null)
    if (file) out.push({ slug, meta: file.meta })
  }
  return out
}

/** Delete a song and its assets by slug (no-op if absent). */
export async function deleteSong(slug: string): Promise<void> {
  try {
    const dir = await songsDir(false)
    await dir.removeEntry(slug, { recursive: true })
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
}

/**
 * Rename a song directory — merges old data into the new slug directory.
 *
 * New samples may have already been written to the new slug (because the
 * slug follows the name in real-time), so we merge rather than replace.
 * Content-addressed samples (unique hashes) won't collide; `song.json`
 * from the old directory is overwritten by the subsequent `writeSong`.
 */
export async function moveSongDir(oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return
  const dir = await songsDir(false)

  // Try native move first (Chromium 125+, Firefox). Native move fails if
  // the target already exists, which is the common case here — but it's
  // atomic and fast, so try it anyway.
  try {
    await (dir as any).move?.(oldSlug, newSlug)
    return
  } catch { /* target likely exists, fall through to merge */ }

  // Merge: copy old → new (skip existing), then delete old.
  let srcDir: FileSystemDirectoryHandle
  try {
    srcDir = await dir.getDirectoryHandle(oldSlug)
  } catch {
    return // old slug doesn't exist — nothing to move
  }
  const dstDir = await dir.getDirectoryHandle(newSlug, { create: true })
  await copyDir(srcDir, dstDir)
  await dir.removeEntry(oldSlug, { recursive: true })
}

/** Recursively copy all entries from src to dst directory handle. */
async function copyDir(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of (src as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === 'file') {
      const srcFile = await (handle as FileSystemFileHandle).getFile()
      const dstFile = await dst.getFileHandle(name, { create: true })
      const w = await dstFile.createWritable()
      await w.write(await srcFile.arrayBuffer())
      await w.close()
    } else if (handle.kind === 'directory') {
      const subSrc = await src.getDirectoryHandle(name)
      const subDst = await dst.getDirectoryHandle(name, { create: true })
      await copyDir(subSrc, subDst)
    }
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError'
}

// --- Recent song (last-opened, restored on startup) ---

const RECENT_FILE = 'recent'

/**
 * Remember which song was open last so the app can restore it on the next
 * startup. Does nothing (silently catches) if OPFS is unavailable.
 */
export async function saveRecent(slug: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(RECENT_FILE, { create: true })
    const writable = await handle.createWritable()
    await writable.write(slug)
    await writable.close()
  } catch {
    // Non-critical — OPFS may not be available (tests, old browsers).
  }
}

/**
 * Return the slug of the last-opened song, or null if no recent song exists or
 * OPFS is unavailable.
 */
export async function loadRecent(): Promise<string | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(RECENT_FILE)
    const text = await (await handle.getFile()).text()
    return text.trim() || null
  } catch {
    return null
  }
}
