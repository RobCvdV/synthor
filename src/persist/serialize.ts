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
export const CURRENT_SCHEMA_VERSION = 5

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

  // v2→v3: sections entity map, sectionIds on doc, volume+noteOff on cells.
  if (version < 3) raw = upgradeV2toV3(raw)

  // v3→v4: drumkit slots changed from noteLo/noteHi ranges to single-note inheritance.
  if (version < 4) raw = upgradeV3toV4(raw)

  // v4→v5: effect + effectValue fields added to Cell.
  if (version < 5) raw = upgradeV4toV5(raw)

  // v1→v1 migration: when the stereo output was added (commit b3917fc), the
  // output module's inlet changed from 'in' to 'inL'. Old modular instruments
  // with connections targeting 'in' would silently produce silence because
  // nothing feeds 'inL'. Fix those connections in-place on load.
  raw = fixOutputPortMigrate(raw)

  // Always ensure every modular instrument has the `volume` singleton source
  // module. This runs on every load (not version-gated) because v3 files saved
  // before the volume module was added also need the fixup.
  raw = ensureVolumeModule(raw)

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
  if (!isRecord(raw.doc.entities.sections)) {
    throw new Error('Not a valid song file: missing doc.entities.sections')
  }
  if (!Array.isArray(raw.doc.sectionIds)) {
    throw new Error('Not a valid song file: missing doc.sectionIds')
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

/** v2→v3: sections, sectionIds, and cell volume+noteOff fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV2toV3(raw: any): any {
  const doc = raw.doc
  if (!doc || !isRecord(doc.entities)) return raw

  const entities = { ...doc.entities }

  // Add sections entity map if missing.
  if (!entities.sections || !isRecord(entities.sections)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sections: Record<string, any> = {}
    // If there's a pattern, wrap it in a default section so the song plays.
    const patternIds = entities.patterns ? Object.keys(entities.patterns) : []
    if (patternIds.length > 0) {
      const secId = 'sec_migrated'
      sections[secId] = { id: secId, name: 'Section 1', patternIds }
    }
    entities.sections = sections
  }

  // Add sectionIds if missing.
  const sectionIds = Array.isArray(raw.doc.sectionIds) ? raw.doc.sectionIds : []
  if (sectionIds.length === 0 && entities.sections) {
    const ids = Object.keys(entities.sections)
    if (ids.length > 0) sectionIds.push(ids[0])
  }

  // Add volume + noteOff to all cells in all tracks.
  if (entities.tracks && isRecord(entities.tracks)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracks: Record<string, any> = {}
    for (const [tid, track] of Object.entries(entities.tracks)) {
      if (isRecord(track) && Array.isArray(track.cells)) {
        tracks[tid] = {
          ...track,
          cells: track.cells.map((c: unknown) =>
            isRecord(c)
              ? { note: c.note ?? null, volume: c.volume ?? null, noteOff: c.noteOff ?? false }
              : { note: null, volume: null, noteOff: false },
          ),
        }
      } else {
        tracks[tid] = track
      }
    }
    entities.tracks = tracks
  }

  return { ...raw, schemaVersion: 3, doc: { ...doc, entities, sectionIds } }
}

/** v3→v4: drumkit slots from note-range (noteLo/noteHi) to single-note inheritance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV3toV4(raw: any): any {
  const insts = raw.doc?.entities?.instruments
  if (!insts || !isRecord(insts)) return raw

  let changed = false
  const fixed: Record<string, unknown> = {}
  for (const [id, inst] of Object.entries(insts)) {
    if (!isRecord(inst) || inst.kind !== 'drumkit') {
      fixed[id] = inst
      continue
    }
    const oldSlots = Array.isArray(inst.slots) ? inst.slots : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSlots: any[] = []
    for (const s of oldSlots) {
      if (!isRecord(s)) continue
      // Convert noteLo → note, drop noteHi. Use noteLo if present, fall back to note for forward compat.
      const note = typeof s.noteLo === 'number' ? s.noteLo : typeof s.note === 'number' ? s.note : 36
      newSlots.push({
        id: typeof s.id === 'string' ? s.id : `slot_${crypto.randomUUID()}`,
        note,
        sampleId: typeof s.sampleId === 'string' ? s.sampleId : null,
        instrumentId: typeof s.instrumentId === 'string' ? s.instrumentId : null,
        pitchOffset: typeof s.pitchOffset === 'number' ? s.pitchOffset : 0,
        gain: typeof s.gain === 'number' ? s.gain : 1,
        pan: typeof s.pan === 'number' ? s.pan : 0,
      })
    }
    // Sort by note ascending so the inheritance model is correct.
    newSlots.sort((a: any, b: any) => a.note - b.note)
    fixed[id] = {
      ...inst,
      slots: newSlots,
      keyLo: typeof inst.keyLo === 'number' ? inst.keyLo : 36,
      keyHi: typeof inst.keyHi === 'number' ? inst.keyHi : 60,
    }
    changed = true
  }

  if (!changed) return raw
  return {
    ...raw,
    schemaVersion: 4,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, instruments: fixed } },
  }
}

/** v4→v5: effect + effectValue fields on every cell. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV4toV5(raw: any): any {
  const entities = raw.doc?.entities
  if (!entities || !isRecord(entities.tracks)) return raw

  let changed = false
  const tracks: Record<string, unknown> = {}
  for (const [tid, track] of Object.entries(entities.tracks)) {
    if (isRecord(track) && Array.isArray(track.cells)) {
      const cells = track.cells.map((c: unknown) =>
        isRecord(c)
          ? { ...c, effect: c.effect ?? null, effectValue: c.effectValue ?? null }
          : { note: null, volume: null, noteOff: false, effect: null, effectValue: null },
      )
      // Only mark changed if at least one cell actually got new fields.
      if (track.cells.some((c: unknown) => isRecord(c) && (c.effect === undefined || c.effectValue === undefined))) {
        changed = true
      }
      tracks[tid] = { ...track, cells }
    } else {
      tracks[tid] = track
    }
  }

  if (!changed) return { ...raw, schemaVersion: 5 }
  return {
    ...raw,
    schemaVersion: 5,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, tracks } },
  }
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

/**
 * Ensure every modular instrument has the `volume` singleton source module.
 * Runs on every load (not version-gated) so even v3 files saved before the
 * volume module was added get the fixup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Ensure every modular instrument has the `volume` singleton source module.
 * Also cleans up the `mod_volume_migrated` ID from an earlier broken migration.
 * Runs on every load (not version-gated).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureVolumeModule(raw: any): any {
  const insts = raw.doc?.entities?.instruments
  if (!insts || !isRecord(insts)) return raw

  let changed = false
  const fixed: Record<string, unknown> = {}
  for (const [id, inst] of Object.entries(insts)) {
    if (!isRecord(inst) || inst.kind !== 'modular' || !isRecord(inst.modules)) {
      fixed[id] = inst
      continue
    }
    const mods = inst.modules as Record<string, unknown>
    const hasVolume = Object.values(mods).some(
      (m) => isRecord(m) && m.type === 'volume' && m.id !== 'mod_volume_migrated',
    )
    // Clean up broken migration ID if present.
    const cleaned: Record<string, unknown> = {}
    for (const [mid, m] of Object.entries(mods)) {
      if (mid === 'mod_volume_migrated' && isRecord(m) && m.type === 'volume') {
        changed = true
        continue // drop this module
      }
      cleaned[mid] = m
    }
    if (!hasVolume) {
      const volId = `vol_${crypto.randomUUID()}`
      cleaned[volId] = { id: volId, type: 'volume', params: {}, pos: { x: 40, y: 440 } }
      changed = true
    }
    if (changed) {
      fixed[id] = { ...inst, modules: cleaned }
    } else {
      fixed[id] = inst
    }
  }

  if (!changed) return raw
  return {
    ...raw,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, instruments: fixed } },
  }
}
