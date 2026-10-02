/**
 * Songs in the active storage backend:
 *
 *   songs/
 *     <slug>/
 *       song.json      ← the SongFile
 *       samples/       ← content-addressed binary assets
 *
 * The human name lives inside `song.json`'s meta; the directory is a sanitized
 * slug so arbitrary titles are safe as folder names.
 */
import { deserializeSong, serializeSong, type SongFile } from './serialize'
import { joinPath, mergeMove, requireStorage, storage } from './storage'

const SONGS_DIR = 'songs'
const SONG_FILE = 'song.json'
const RECENT_FILE = 'recent'

/** Sanitize a display name into a safe directory slug. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

export function songDir(slug: string): string {
  return joinPath(SONGS_DIR, slug)
}

/** Write (create or overwrite) a song under its slug. */
export async function writeSong(file: SongFile, slug = slugify(file.meta.name)): Promise<string> {
  await requireStorage().write(joinPath(songDir(slug), SONG_FILE), serializeSong(file))
  return slug
}

/** Read a song by slug, or null if it doesn't exist. */
export async function readSong(slug: string): Promise<SongFile | null> {
  const text = await requireStorage().readText(joinPath(songDir(slug), SONG_FILE))
  return text === null ? null : deserializeSong(text)
}

/** List every stored song's slug + metadata, skipping unreadable entries. */
export async function listSongs(): Promise<Array<{ slug: string; meta: SongFile['meta'] }>> {
  const out: Array<{ slug: string; meta: SongFile['meta'] }> = []
  for (const entry of await requireStorage().list(SONGS_DIR)) {
    if (entry.kind !== 'directory') continue
    const file = await readSong(entry.name).catch(() => null)
    if (file) out.push({ slug: entry.name, meta: file.meta })
  }
  return out
}

/** Delete a song and its assets by slug (no-op if absent). */
export async function deleteSong(slug: string): Promise<void> {
  await requireStorage().remove(songDir(slug))
}

/**
 * Rename a song directory, merging into the new slug: samples may already
 * have been written there, since the slug follows the name as it's typed.
 */
export async function moveSongDir(oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return
  await mergeMove(requireStorage(), songDir(oldSlug), songDir(newSlug))
}

// --- Recent song (last-opened, restored on startup) ---

/** Remember which song was open last. Non-critical, so failures are ignored. */
export async function saveRecent(slug: string): Promise<void> {
  try {
    await storage()?.write(RECENT_FILE, slug)
  } catch {
    // Non-critical.
  }
}

/** The slug of the last-opened song, or null. */
export async function loadRecent(): Promise<string | null> {
  try {
    return (await storage()?.readText(RECENT_FILE))?.trim() || null
  } catch {
    return null
  }
}
