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
import { nextEffName } from '../domain/factory'
import { defaultParams } from '../domain/moduleDefs'

/**
 * Bump when the on-disk shape changes; add a matching `migrate` case.
 */
export const CURRENT_SCHEMA_VERSION = 10

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

  // v5→v6: replace packed effect/effectValue with per-lane effectLanes system.
  if (version < 6) raw = upgradeV5toV6(raw)

  // v6→v7: add mixer channels, instrument routing (channelId, pan), and mixerInstrumentOrder.
  if (version < 7) raw = upgradeV6toV7(raw)

  // v7→v8: drumkit slots: pitchOffset→baseNote, gain→volume; sample node centerNote→playRate+finetune.
  if (version < 8) raw = upgradeV7toV8(raw)

  // v8→v9: delay/echo `time` param changed from milliseconds to tempo ticks.
  if (version < 9) raw = upgradeV8toV9(raw)

  // v9→v10: osc instruments removed — converted to minimal modular synths.
  if (version < 10) raw = upgradeV9toV10(raw)

  // v1→v1 migration: when the stereo output was added (commit b3917fc), the
  // output module's inlet changed from 'in' to 'inL'. Old modular instruments
  // with connections targeting 'in' would silently produce silence because
  // nothing feeds 'inL'. Fix those connections in-place on load.
  raw = fixOutputPortMigrate(raw)

  // Always ensure every modular instrument has the `volume` singleton source
  // module. This runs on every load (not version-gated) because v3 files saved
  // before the volume module was added also need the fixup.
  raw = ensureVolumeModule(raw)

  // Convert old effect1/effect2 modules to `eff` modules. Runs on every load
  // (not version-gated) so patches created before the change get updated.
  raw = convertEffectModules(raw)
  // Backfill unique names on eff modules (palette-created ones used to be
  // unnamed and therefore unreachable from tracker lanes). Runs on every
  // load so existing saves recover without a version bump.
  raw = nameEffModules(raw)
  // Merge old portaUp / portaDown lanes into portamento.
  raw = convertPortaLanes(raw)

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
  if (!isRecord(raw.doc.entities.mixChannels)) {
    throw new Error('Not a valid song file: missing doc.entities.mixChannels')
  }
  if (!Array.isArray(raw.doc.entities.mixerInstrumentOrder)) {
    throw new Error('Not a valid song file: missing doc.entities.mixerInstrumentOrder')
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

/** v5→v6: strip packed effect fields, add effectLanes to cells and tracks,
 *  convert effect1/effect2 modules to `eff` modules with names. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV5toV6(raw: any): any {
  const entities = raw.doc?.entities
  if (!entities || !isRecord(entities.tracks)) return raw

  let changed = false

  // Fix tracks: strip old effect/effectValue from cells, add effectLanes.
  const tracks: Record<string, unknown> = {}
  for (const [tid, track] of Object.entries(entities.tracks)) {
    if (isRecord(track) && Array.isArray(track.cells)) {
      tracks[tid] = {
        ...track,
        effectLanes: Array.isArray(track.effectLanes) ? track.effectLanes : [],
        cells: track.cells.map((c: unknown) => {
          if (!isRecord(c)) return { note: null, volume: null, noteOff: false, effectLanes: {} }
          const { effect, effectValue, ...rest } = c as any
          return { ...rest, effectLanes: isRecord(c.effectLanes) ? c.effectLanes : {} }
        }),
      }
      changed = true
    } else {
      tracks[tid] = track
    }
  }

  if (changed) {
    entities.tracks = tracks
  }

  return { ...raw, schemaVersion: 6, doc: { ...raw.doc, entities } }
}

/** v6→v7: add mixChannels, mixerInstrumentOrder, channelId + pan on instruments. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV6toV7(raw: any): any {
  const entities = raw.doc?.entities
  if (!entities || !isRecord(entities)) return raw

  const ee = { ...entities }

  // Add master channel if missing.
  if (!ee.mixChannels || !isRecord(ee.mixChannels)) {
    ee.mixChannels = {
      master: { id: 'master', name: 'Master', kind: 'master', volume: 1, pan: 0, mute: false, solo: false, effects: [] },
    }
  }

  // Add mixerInstrumentOrder if missing — all existing instruments in creation order.
  if (!Array.isArray(ee.mixerInstrumentOrder)) {
    const insts = isRecord(ee.instruments) ? ee.instruments as Record<string, unknown> : {}
    ee.mixerInstrumentOrder = Object.keys(insts)
  }

  // Add channelId + pan to all instruments.
  if (isRecord(ee.instruments)) {
    const insts = ee.instruments as Record<string, unknown>
    const fixed: Record<string, unknown> = {}
    for (const [id, inst] of Object.entries(insts)) {
      if (isRecord(inst) && (inst.kind === 'osc' || inst.kind === 'modular' || inst.kind === 'drumkit')) {
        fixed[id] = {
          ...inst,
          channelId: typeof inst.channelId === 'string' ? inst.channelId : 'master',
          pan: typeof inst.pan === 'number' ? inst.pan : 0,
        }
      } else {
        fixed[id] = inst
      }
    }
    ee.instruments = fixed
  }

  return { ...raw, schemaVersion: 7, doc: { ...raw.doc, entities: ee } }
}

function upgradeV7toV8(raw: any): any {
  const entities = raw.doc?.entities
  if (!entities || !isRecord(entities)) return raw

  const ee = { ...entities }

  // Drumkit slots: pitchOffset→baseNote (preserving first-key pitch), gain→volume.
  if (isRecord(ee.instruments)) {
    const insts = ee.instruments as Record<string, unknown>
    const fixed: Record<string, unknown> = {}
    for (const [id, inst] of Object.entries(insts)) {
      if (isRecord(inst) && inst.kind === 'drumkit' && Array.isArray((inst as any).slots)) {
        fixed[id] = {
          ...inst,
          slots: (inst as any).slots.map((s: any) => {
            const base = isRecord(s) ? s : {}
            return {
              ...base,
              baseNote: 60 + (typeof base.pitchOffset === 'number' ? base.pitchOffset : 0),
              volume: typeof base.gain === 'number' ? base.gain : 1,
            }
          }),
        }
      } else {
        fixed[id] = inst
      }
    }
    ee.instruments = fixed
  }

  // Sample modules: remove stale centerNote, ensure playRate + finetune exist.
  if (isRecord(ee.instruments)) {
    const insts = ee.instruments as Record<string, unknown>
    const fixedInst: Record<string, unknown> = {}
    for (const [id, inst] of Object.entries(insts)) {
      if (isRecord(inst) && inst.kind === 'modular' && isRecord((inst as any).modules)) {
        const mods = (inst as any).modules as Record<string, unknown>
        const fixedMods: Record<string, unknown> = {}
        for (const [mid, mod] of Object.entries(mods)) {
          if (isRecord(mod) && mod.type === 'sample' && isRecord(mod.params)) {
            const p = { ...mod.params as Record<string, unknown> }
            delete p.centerNote
            if (typeof p.playRate !== 'number') p.playRate = 0
            if (typeof p.finetune !== 'number') p.finetune = 0
            if (typeof p.pitchTrack !== 'number') p.pitchTrack = 1
            fixedMods[mid] = { ...mod, params: p }
          } else {
            fixedMods[mid] = mod
          }
        }
        fixedInst[id] = { ...inst, modules: fixedMods }
      } else {
        fixedInst[id] = inst
      }
    }
    ee.instruments = fixedInst
  }

  return { ...raw, schemaVersion: 8, doc: { ...raw.doc, entities: ee } }
}

/** Row duration at the default tempo (120 BPM, 4 rows/beat) — used to convert
 *  legacy millisecond delay times to ticks. */
const LEGACY_ROW_MS = 125

/** Convert a legacy ms delay time to ticks: nearest quarter tick, 0.25..16. */
function msToTicks(ms: number): number {
  const q = Math.round(ms / LEGACY_ROW_MS / 0.25) * 0.25
  return Math.min(16, Math.max(0.25, q))
}

/** v8→v9: convert delay/echo `time` params from milliseconds to tempo ticks,
 *  on both modular instrument modules and mix-channel effects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV8toV9(raw: any): any {
  const entities = raw.doc?.entities
  if (!entities || !isRecord(entities)) return raw

  const ee = { ...entities }
  let changed = false

  if (isRecord(ee.instruments)) {
    const insts = ee.instruments as Record<string, unknown>
    const fixedInsts: Record<string, unknown> = {}
    for (const [iid, inst] of Object.entries(insts)) {
      if (isRecord(inst) && inst.kind === 'modular' && isRecord(inst.modules)) {
        const mods = inst.modules as Record<string, unknown>
        const fixedMods: Record<string, unknown> = {}
        for (const [mid, mod] of Object.entries(mods)) {
          if (isRecord(mod) && (mod.type === 'delay' || mod.type === 'echo')
            && isRecord(mod.params) && typeof mod.params.time === 'number') {
            fixedMods[mid] = { ...mod, params: { ...mod.params, time: msToTicks(mod.params.time) } }
            changed = true
          } else {
            fixedMods[mid] = mod
          }
        }
        fixedInsts[iid] = { ...inst, modules: fixedMods }
      } else {
        fixedInsts[iid] = inst
      }
    }
    ee.instruments = fixedInsts
  }

  if (isRecord(ee.mixChannels)) {
    const chans = ee.mixChannels as Record<string, unknown>
    const fixedChans: Record<string, unknown> = {}
    for (const [cid, chan] of Object.entries(chans)) {
      if (isRecord(chan) && Array.isArray(chan.effects)) {
        const fx = (chan.effects as unknown[]).map((f) => {
          if (isRecord(f) && (f.type === 'delay' || f.type === 'echo')
            && isRecord(f.params) && typeof f.params.time === 'number') {
            changed = true
            return { ...f, params: { ...f.params, time: msToTicks(f.params.time) } }
          }
          return f
        })
        fixedChans[cid] = { ...chan, effects: fx }
      } else {
        fixedChans[cid] = chan
      }
    }
    ee.mixChannels = fixedChans
  }

  if (!changed) return { ...raw, schemaVersion: 9 }
  return { ...raw, schemaVersion: 9, doc: { ...raw.doc, entities: ee } }
}

/**
 * Build the minimal modular patch an osc instrument is converted to — a saw
 * osc through an ADSR-shaped gain, matching the old built-in voice. The old
 * instrument-level gain lands on the output module.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function oscToModular(inst: any): any {
  const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
  const noteId = id('note')
  const gateId = id('gate')
  const oscId = id('osc')
  const adsrId = id('adsr')
  const gainId = id('gain')
  const outId = id('out')

  const modules: Record<string, unknown> = {
    [noteId]: { id: noteId, type: 'note', params: {}, pos: { x: 40, y: 40 } },
    [gateId]: { id: gateId, type: 'gate', params: {}, pos: { x: 40, y: 240 } },
    [oscId]: { id: oscId, type: 'osc', params: defaultParams('osc'), pos: { x: 260, y: 40 } },
    [adsrId]: { id: adsrId, type: 'adsr', params: defaultParams('adsr'), pos: { x: 260, y: 240 } },
    [gainId]: { id: gainId, type: 'gain', params: defaultParams('gain'), pos: { x: 480, y: 140 } },
    [outId]: { id: outId, type: 'output', params: { ...defaultParams('output'), gain: inst.params?.gain ?? 1 }, pos: { x: 700, y: 160 } },
  }
  const con = (from: string, fromPort: string, to: string, toPort: string): [string, Record<string, unknown>] => {
    const cid = id('con')
    return [cid, { id: cid, from: { moduleId: from, port: fromPort }, to: { moduleId: to, port: toPort }, gain: 1 }]
  }
  const connections = Object.fromEntries([
    con(noteId, 'freq', oscId, 'freq'),
    con(oscId, 'out', gainId, 'in'),
    con(gateId, 'gate', adsrId, 'gate'),
    con(adsrId, 'env', gainId, 'mod'),
    con(gainId, 'out', outId, 'inL'),
  ])

  return {
    id: inst.id,
    kind: 'modular',
    name: inst.name,
    modules,
    connections,
    outputId: outId,
    effectSettings: inst.effectSettings,
    channelId: typeof inst.channelId === 'string' ? inst.channelId : 'master',
    pan: typeof inst.pan === 'number' ? inst.pan : 0,
    midiChannel: inst.midiChannel,
  }
}

/** v9→v10: the built-in osc instrument is gone — convert any remaining osc
 *  instruments into minimal modular synths so old songs keep playing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeV9toV10(raw: any): any {
  const insts = raw.doc?.entities?.instruments
  if (!insts || !isRecord(insts)) return { ...raw, schemaVersion: 10 }

  let changed = false
  const fixed: Record<string, unknown> = {}
  for (const [iid, inst] of Object.entries(insts)) {
    if (isRecord(inst) && inst.kind === 'osc') {
      fixed[iid] = oscToModular(inst)
      changed = true
    } else {
      fixed[iid] = inst
    }
  }

  if (!changed) return { ...raw, schemaVersion: 10 }
  return { ...raw, schemaVersion: 10, doc: { ...raw.doc, entities: { ...raw.doc.entities, instruments: fixed } } }
}

/**
 * Convert old effect1/effect2 modules to `eff` modules on every modular
 * instrument. Runs on every load (not version-gated).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertEffectModules(raw: any): any {
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
    const conns = isRecord(inst.connections) ? inst.connections as Record<string, unknown> : {}
    const newMods: Record<string, unknown> = {}
    const newConns: Record<string, unknown> = {}
    const idMap = new Map<string, string>()

    for (const [mid, m] of Object.entries(mods)) {
      if (isRecord(m) && (m.type === 'effect1' || m.type === 'effect2')) {
        const newId = `eff_${crypto.randomUUID()}`
        const effNum = m.type === 'effect1' ? '01' : '02'
        idMap.set(mid, newId)
        newMods[newId] = {
          id: newId,
          type: 'eff',
          name: `Eff ${effNum}`,
          params: { cc: typeof m.cc === 'number' ? m.cc : 0 },
          pos: isRecord(m.pos) ? m.pos : { x: 40, y: m.type === 'effect2' ? 840 : 640 },
        }
        changed = true
      } else {
        newMods[mid] = m
      }
    }

    // Fix connection references from old module IDs to new eff module IDs.
    for (const [cid, c] of Object.entries(conns)) {
      if (!isRecord(c) || !isRecord(c.from) || !isRecord(c.to)) {
        newConns[cid] = c
        continue
      }
      const fromId = idMap.get(c.from.moduleId as string)
      const toId = idMap.get(c.to.moduleId as string)
      if (fromId || toId) {
        changed = true
        newConns[cid] = {
          ...c,
          from: fromId ? { ...c.from, moduleId: fromId } : c.from,
          to: toId ? { ...c.to, moduleId: toId } : c.to,
        }
      } else {
        newConns[cid] = c
      }
    }

    fixed[id] = changed
      ? { ...inst, modules: newMods, connections: newConns }
      : inst
  }

  if (!changed) return raw
  return {
    ...raw,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, instruments: fixed } },
  }
}

/**
 * Give every `eff` module a unique name. Palette-created eff modules were
 * stored unnamed, which made them invisible to the tracker lane picker and
 * the engine (lanes address inlets by name). Unnamed modules get the next
 * free "Eff In NN" name; duplicate names are renamed the same way so the
 * first occurrence keeps its name and keeps any lanes bound to it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameEffModules(raw: any): any {
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
    const seen = new Set<string>()
    const named: Record<string, unknown> = {}
    for (const [mid, m] of Object.entries(mods)) {
      if (!isRecord(m) || m.type !== 'eff') {
        named[mid] = m
        continue
      }
      const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : ''
      if (name && !seen.has(name)) {
        seen.add(name)
        named[mid] = { ...m, name }
        continue
      }
      const fresh = nextEffName(seen)
      seen.add(fresh)
      named[mid] = { ...m, name: fresh }
      changed = true
    }
    if (changed) fixed[id] = { ...inst, modules: named }
    else fixed[id] = inst
  }

  if (!changed) return raw
  return {
    ...raw,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, instruments: fixed } },
  }
}

/**
 * Convert old portaUp / portaDown effect lanes to the merged `portamento` type.
 * portaUp values (0→1 means 0→max up) remap to portamento (0.5→1 means center→up).
 * portaDown values (0→1 means 0→max down) remap to portamento (0.5→0 means center→down).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertPortaLanes(raw: any): any {
  const tracks = raw.doc?.entities?.tracks
  if (!tracks || !isRecord(tracks)) return raw

  let changed = false
  const fixed: Record<string, unknown> = {}
  for (const [tid, track] of Object.entries(tracks)) {
    if (!isRecord(track) || !Array.isArray(track.effectLanes)) {
      fixed[tid] = track
      continue
    }
    const lanes = track.effectLanes as Array<Record<string, unknown>>
    const newLanes = lanes.map((lane) => {
      if (lane.type === 'portaUp' || lane.type === 'portaDown') {
        changed = true
        const isUp = lane.type === 'portaUp'
        return { ...lane, type: 'portamento', _wasPortaDir: isUp ? 'up' : 'down' }
      }
      return lane
    })
    if (!changed) {
      fixed[tid] = track
      continue
    }

    // Remap cell values: portaUp 0→0.5,1→1; portaDown 0→0.5,1→0.
    const cells = Array.isArray(track.cells) ? track.cells as Array<Record<string, unknown>> : []
    const newCells = cells.map((cell) => {
      const el = (cell.effectLanes ?? {}) as Record<string, unknown>
      if (!isRecord(el)) return cell
      const newEl: Record<string, unknown> = {}
      for (const [lid, val] of Object.entries(el)) {
        const lane = newLanes.find((l) => l.id === lid)
        if (lane && (lane._wasPortaDir || (lane as any)._wasPortaDir)) {
          const isUp = (lane as any)._wasPortaDir === 'up'
          if (typeof val === 'number') {
            newEl[lid] = isUp ? 0.5 + val * 0.5 : 0.5 - val * 0.5
          } else {
            newEl[lid] = val
          }
        } else {
          newEl[lid] = val
        }
      }
      return { ...cell, effectLanes: newEl }
    })

    // Strip temporary _wasPortaDir from lane defs.
    const cleanLanes = newLanes.map(({ _wasPortaDir: _, ...rest }) => rest)
    fixed[tid] = { ...track, effectLanes: cleanLanes, cells: newCells }
  }

  if (!changed) return raw
  return {
    ...raw,
    doc: { ...raw.doc, entities: { ...raw.doc.entities, tracks: fixed } },
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
