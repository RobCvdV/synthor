/**
 * Fills in whatever a loaded document lacks, so a damaged or mislabelled file still opens and
 * plays: missing fields get their defaults, references to things that don't exist are dropped.
 * Valid values are never changed. Runs at the end of every migration.
 */
import { createMasterChannel, fitCells } from '../domain/factory'
import { defaultParams, MODULE_DEFS } from '../domain/moduleDefs'
import { DEFAULT_EFFECT_SETTINGS, DEFAULT_TEMPO, MASTER_CHANNEL_ID, MAX_BPM, MIN_BPM, type ModuleType } from '../domain/types'
import { completeGame } from './completeGame'

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const recOf = (v: unknown): Rec => (isRec(v) ? v : {})
const arrOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isModuleType = (t: unknown): t is ModuleType => typeof t === 'string' && Object.hasOwn(MODULE_DEFS, t)

/** Missing or non-numeric params of a module type get their defaults; extra keys are kept. */
function completeParams(type: ModuleType, params: unknown): Rec {
  const given = recOf(params)
  const out: Rec = { ...given }
  for (const [key, value] of Object.entries(defaultParams(type))) out[key] = num(given[key], value)
  return out
}

function completeModular(inst: Rec): Rec {
  const modules: Rec = {}
  for (const [id, raw] of Object.entries(recOf(inst.modules))) {
    if (!isRec(raw) || !isModuleType(raw.type)) continue
    const pos = recOf(raw.pos)
    modules[id] = { ...raw, id, params: completeParams(raw.type, raw.params), pos: { x: num(pos.x, 0), y: num(pos.y, 0) } }
  }
  let outputId = str(inst.outputId, '')
  if ((modules[outputId] as Rec | undefined)?.type !== 'output') {
    const existing = Object.values(modules).find((m) => (m as Rec).type === 'output') as Rec | undefined
    outputId = existing ? (existing.id as string) : `${str(inst.id, 'inst')}:output`
    modules[outputId] ??= { id: outputId, type: 'output', params: defaultParams('output'), pos: { x: 700, y: 160 } }
  }

  const hasPort = (end: unknown, side: 'inlets' | 'outlets') => {
    const port = recOf(end)
    const m = modules[str(port.moduleId, '')] as Rec | undefined
    return !!m && MODULE_DEFS[m.type as ModuleType][side].includes(str(port.port, ''))
  }
  const connections: Rec = {}
  for (const [id, raw] of Object.entries(recOf(inst.connections))) {
    if (!isRec(raw) || !hasPort(raw.from, 'outlets') || !hasPort(raw.to, 'inlets')) continue
    connections[id] = { ...raw, id, gain: num(raw.gain, 1) }
  }

  return {
    ...inst,
    name: str(inst.name, 'Synth'),
    modules,
    connections,
    outputId,
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS, ...recOf(inst.effectSettings) },
    channelId: str(inst.channelId, MASTER_CHANNEL_ID),
    pan: num(inst.pan, 0),
  }
}

function completeDrumKit(inst: Rec): Rec {
  const slots = arrOf(inst.slots)
    .filter((s): s is Rec => isRec(s) && typeof s.note === 'number')
    .map((s) => {
      // Pre-v8 slots had pitchOffset/gain where baseNote/volume are now.
      const { pitchOffset, gain, ...rest } = s
      return {
        ...rest,
        note: s.note as number,
        id: str(s.id, `slot_${crypto.randomUUID()}`),
        sampleId: typeof s.sampleId === 'string' ? s.sampleId : null,
        instrumentId: typeof s.instrumentId === 'string' ? s.instrumentId : null,
        baseNote: num(s.baseNote, 60 + num(pitchOffset, 0)),
        volume: num(s.volume, num(gain, 1)),
        pan: num(s.pan, 0),
      }
    })
    .sort((a, b) => a.note - b.note)
  return {
    ...inst,
    name: str(inst.name, 'Drum Kit'),
    slots,
    keyLo: num(inst.keyLo, 36),
    keyHi: num(inst.keyHi, 60),
    params: { ...recOf(inst.params), gain: num(recOf(inst.params).gain, 1) },
    channelId: str(inst.channelId, MASTER_CHANNEL_ID),
    pan: num(inst.pan, 0),
  }
}

function completeChannel(id: string, raw: Rec): Rec {
  const effects = arrOf(raw.effects)
    .filter((e): e is Rec => isRec(e) && isModuleType(e.type))
    .map((e) => ({ ...e, id: str(e.id, `chef_${crypto.randomUUID()}`), params: completeParams(e.type as ModuleType, e.params) }))
  return {
    ...raw,
    id,
    name: str(raw.name, id === MASTER_CHANNEL_ID ? 'Master' : 'Channel'),
    kind: id === MASTER_CHANNEL_ID ? 'master' : 'sub',
    volume: num(raw.volume, 1),
    pan: num(raw.pan, 0),
    mute: bool(raw.mute, false),
    solo: bool(raw.solo, false),
    effects,
  }
}

function completeCell(raw: unknown): Rec {
  const c = recOf(raw)
  return {
    ...c,
    note: typeof c.note === 'number' ? c.note : null,
    volume: typeof c.volume === 'number' ? c.volume : null,
    noteOff: bool(c.noteOff, false),
    hold: bool(c.hold, false),
    effectLanes: recOf(c.effectLanes),
  }
}

/** The song file with every entity completed (see the module comment). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function completeDoc(raw: any): any {
  if (!isRec(raw) || !isRec(raw.doc)) return raw
  const doc = raw.doc
  const e = recOf(doc.entities)

  const mixChannels: Rec = {}
  for (const [id, ch] of Object.entries(recOf(e.mixChannels))) if (isRec(ch)) mixChannels[id] = completeChannel(id, ch)
  if (!mixChannels[MASTER_CHANNEL_ID]) mixChannels[MASTER_CHANNEL_ID] = createMasterChannel()

  const instruments: Rec = {}
  for (const [id, inst] of Object.entries(recOf(e.instruments))) {
    if (!isRec(inst)) continue
    if (inst.kind === 'modular') instruments[id] = completeModular({ ...inst, id })
    else if (inst.kind === 'drumkit') instruments[id] = completeDrumKit({ ...inst, id })
  }

  const tracks: Rec = {}
  for (const [id, t] of Object.entries(recOf(e.tracks))) {
    if (!isRec(t)) continue
    tracks[id] = { ...t, id, cells: arrOf(t.cells).map(completeCell), effectLanes: arrOf(t.effectLanes).filter(isRec) }
  }

  const patterns: Rec = {}
  for (const [id, p] of Object.entries(recOf(e.patterns))) {
    if (!isRec(p)) continue
    const trackIds = arrOf(p.trackIds).filter((tid): tid is string => typeof tid === 'string' && !!tracks[tid])
    const length = Math.max(1, Math.round(num(p.length, (tracks[trackIds[0]] as Rec | undefined)?.cells ? ((tracks[trackIds[0]] as Rec).cells as unknown[]).length : 16)))
    // Every track holds exactly one cell per pattern row.
    for (const tid of trackIds) {
      const t = tracks[tid] as Rec
      if ((t.cells as unknown[]).length !== length) t.cells = fitCells(t.cells as never, length)
    }
    patterns[id] = { ...p, id, name: str(p.name, 'Pattern'), length, trackIds }
  }

  const sections: Rec = {}
  for (const [id, s] of Object.entries(recOf(e.sections))) {
    if (!isRec(s)) continue
    sections[id] = { ...s, id, name: str(s.name, 'Section'), patternIds: arrOf(s.patternIds).filter((pid) => typeof pid === 'string' && !!patterns[pid]) }
  }

  const tempo = recOf(doc.tempo)
  const linesPerBeat = Math.max(1, Math.round(num(tempo.linesPerBeat, DEFAULT_TEMPO.linesPerBeat)))
  const sectionIds = arrOf(doc.sectionIds).filter((sid): sid is string => typeof sid === 'string' && !!sections[sid])
  // a game names cues as the player finds them: arranged sections and patterns, by id or name
  const names = (ids: string[], map: Rec) => ids.flatMap((id) => [id, str((map[id] as Rec).name, '')])
  const game = completeGame(doc.game, {
    cues: new Set([...names(sectionIds, sections), ...names(Object.keys(patterns), patterns)]),
    instruments: new Set(names(Object.keys(instruments), instruments)),
    linesPerBeat,
  })
  const mixerInstrumentOrder = arrOf(e.mixerInstrumentOrder).filter((iid): iid is string => typeof iid === 'string' && !!instruments[iid])
  const { game: _rawGame, ...rest } = doc
  return {
    ...raw,
    doc: {
      ...rest,
      sectionIds,
      tempo: {
        bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, num(tempo.bpm, DEFAULT_TEMPO.bpm))),
        linesPerBeat,
      },
      ...(game ? { game } : {}),
      entities: {
        ...e,
        instruments,
        tracks,
        patterns,
        sections,
        samples: recOf(e.samples),
        mixChannels,
        mixerInstrumentOrder: [...new Set(mixerInstrumentOrder)],
      },
    },
  }
}
