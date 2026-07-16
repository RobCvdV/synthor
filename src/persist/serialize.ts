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

/**
 * Bump when the on-disk shape changes; add a matching `migrate` case.
 *
 * Note: modular instruments (`kind:'modular'` with a module graph) were added
 * without a bump — `Instrument` is a discriminated union, so old v1 files
 * (osc-only) and new files with modular instruments both satisfy the same
 * schema. A bump is only needed for a *breaking* shape change (e.g. sections).
 */
export const CURRENT_SCHEMA_VERSION = 2

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

  // v1→v2: samples entity map added (sample playback + drum kit).
  if (version < 2) raw = upgradeV1toV2(raw)

  // v1→v1 migration: when the stereo output was added (commit b3917fc), the
  // output module's inlet changed from 'in' to 'inL'. Old modular instruments
  // with connections targeting 'in' would silently produce silence because
  // nothing feeds 'inL'. Fix those connections in-place on load.
  raw = fixOutputPortMigrate(raw)

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
  if (!isRecord(raw.doc.entities.samples)) {
    throw new Error('Not a valid song file: missing doc.entities.samples')
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** v1→v2: initialise the samples entity map for old files. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV1toV2(raw: any): any {
  const doc = raw.doc
  if (doc && isRecord(doc.entities) && !doc.entities.samples) {
    return { ...raw, doc: { ...doc, entities: { ...doc.entities, samples: {} } } }
  }
  return raw
}

/**
 * Fix modular instrument connections that target the old output `in` port
 * (pre-stereo, before commit b3917fc). Changes them to `inL` so they feed the
 * left output channel. Returns a new object (doesn't mutate the input) so
 * callers can still compare against the raw parsed file if needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixOutputPortMigrate(raw: any): any {
  const insts = raw.doc?.entities?.instruments
  if (!insts || !isRecord(insts)) return raw

  let changed = false
  const fixed: Record<string, unknown> = {}
  for (const [id, inst] of Object.entries(insts)) {
    if (!isRecord(inst) || inst.kind !== 'modular') {
      fixed[id] = inst
      continue
    }
    const conns = inst.connections
    if (!isRecord(conns)) {
      fixed[id] = inst
      continue
    }
    const fixedConns: Record<string, unknown> = {}
    for (const [cid, c] of Object.entries(conns)) {
      if (isRecord(c) && isRecord(c.to) && c.to.port === 'in') {
        const targetMod = isRecord(inst.modules) ? (inst.modules as Record<string, unknown>)[c.to.moduleId as string] : undefined
        if (isRecord(targetMod) && targetMod.type === 'output') {
          fixedConns[cid] = { ...c, to: { ...c.to, port: 'inL' } }
          changed = true
          continue
        }
      }
      fixedConns[cid] = c
    }
    fixed[id] = { ...inst, connections: fixedConns }
  }

  if (!changed) return raw
  return {
    ...raw,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, instruments: fixed } },
  }
}
