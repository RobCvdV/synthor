/**
 * Song (project) serialization — pure, no I/O. Turns the in-memory Doc into a
 * versioned, JSON-safe SongFile and back, with a migration hook so older files
 * keep loading as the schema grows (e.g. when the sections/song arrangement
 * layer or sample assets land, bump CURRENT_SCHEMA_VERSION and add a case to
 * `migrate`).
 *
 * Binary sample data deliberately never lives here: samples will be stored as
 * separate content-addressed assets and referenced from the doc by id, so this
 * document stays small and cheap to rewrite on every autosave.
 */

import type { Doc } from '../domain/types'

/** Bump when the on-disk shape changes; add a matching `migrate` case. */
export const CURRENT_SCHEMA_VERSION = 1

export interface SongMeta {
  name: string
  /** ISO-8601 timestamps. */
  createdAt: string
  modifiedAt: string
}

/** The serialized project file (`song.json`). */
export interface SongFile {
  schemaVersion: number
  meta: SongMeta
  doc: Doc
}

/** Wrap a doc + metadata into a current-version SongFile. */
export function makeSongFile(doc: Doc, meta: SongMeta): SongFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, meta, doc }
}

/** Serialize to a JSON string (pretty-printed for diff-friendly storage). */
export function serializeSong(file: SongFile): string {
  return JSON.stringify(file, null, 2)
}

/**
 * Parse + validate + migrate a JSON string into a current-version SongFile.
 * Throws a descriptive Error on malformed input rather than returning a
 * half-valid object, so callers can surface a clear failure.
 */
export function deserializeSong(text: string): SongFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a valid song file: invalid JSON')
  }
  return migrate(raw)
}

/**
 * Bring any supported past-version file up to the current schema. Unknown
 * (future) versions are rejected — we can read older files, not newer ones.
 */
export function migrate(raw: unknown): SongFile {
  if (!isRecord(raw)) throw new Error('Not a valid song file: expected an object')

  const version = raw.schemaVersion
  if (typeof version !== 'number') throw new Error('Not a valid song file: missing schemaVersion')
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Song file is version ${version}, newer than this app supports (${CURRENT_SCHEMA_VERSION})`,
    )
  }

  // Future migrations chain here, oldest first:
  //   if (version < 2) raw = upgradeV1toV2(raw)

  assertShape(raw)
  return raw
}

/** Structural guard for the current schema. Narrows `raw` to SongFile. */
function assertShape(raw: unknown): asserts raw is SongFile {
  if (!isRecord(raw)) throw new Error('Not a valid song file: expected an object')
  if (!isRecord(raw.meta) || typeof raw.meta.name !== 'string') {
    throw new Error('Not a valid song file: missing meta.name')
  }
  if (!isRecord(raw.doc) || !isRecord(raw.doc.entities)) {
    throw new Error('Not a valid song file: missing doc.entities')
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
