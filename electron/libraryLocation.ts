/** Where the library lives: a folder the user chose, the app's iCloud Drive folder, or ~/Documents/Synthor. */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { copyLibrary } from './libraryFolder.js'

/** Shown once in the app, e.g. after the move to iCloud Drive or when iCloud Drive is missing. */
export interface LibraryNotice {
  kind: 'info' | 'warn'
  text: string
}

export interface LibraryLocation {
  path: string
  kind: 'custom' | 'icloud' | 'local'
  notice?: LibraryNotice
}

export interface LibrarySettings {
  /** A folder the user picked; wins over everything else. */
  libraryPath?: string
  /** The library was moved to iCloud Drive (so missing iCloud is worth a warning). */
  icloudLibrary?: boolean
}

const ICLOUD_LOOKUP_TIMEOUT_MS = 5000

/** iCloud lookups can stall while the container is set up; startup shouldn't wait for that. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref?.())])
}

const tilde = (p: string) => p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p

async function hasLibrary(dir: string): Promise<boolean> {
  for (const entry of ['songs', 'instruments', 'samples']) {
    const items = await fs.readdir(path.join(dir, entry)).catch(() => [])
    if (items.some((n) => !n.startsWith('.'))) return true
  }
  return false
}

/**
 * Picks the library folder for this launch. The first time iCloud Drive is available, the local
 * library is copied into it (never overwriting, the original stays) and `update` records the move.
 */
export async function resolveLibrary(opts: {
  settings: LibrarySettings
  icloudDocs: Promise<string | null>
  localDefault: string
  update: (patch: LibrarySettings) => void
  copy?: (from: string, to: string) => Promise<void>
}): Promise<LibraryLocation> {
  const { settings, localDefault, update, copy = copyLibrary } = opts
  if (settings.libraryPath) return { path: settings.libraryPath, kind: 'custom' }

  const icloud = await withTimeout(opts.icloudDocs, ICLOUD_LOOKUP_TIMEOUT_MS, null)
  if (!icloud) {
    return {
      path: localDefault,
      kind: 'local',
      notice: settings.icloudLibrary
        ? { kind: 'warn', text: `iCloud Drive isn't available, so Synthor is using the local library in ${tilde(localDefault)}. What you save now won't be in iCloud Drive.` }
        : undefined,
    }
  }
  if (settings.icloudLibrary) return { path: icloud, kind: 'icloud' }

  try {
    const moved = await hasLibrary(localDefault)
    if (moved) await copy(localDefault, icloud)
    update({ icloudLibrary: true })
    return {
      path: icloud,
      kind: 'icloud',
      notice: moved
        ? { kind: 'info', text: `Your library now lives in iCloud Drive › Synthor. The old folder ${tilde(localDefault)} was left as it was.` }
        : undefined,
    }
  } catch (err) {
    console.error('[library] moving to iCloud Drive failed:', err)
    return { path: localDefault, kind: 'local', notice: { kind: 'warn', text: 'Moving the library to iCloud Drive failed, so Synthor is using the local library. It will try again next time.' } }
  }
}
