import type {
  Cell,
  Connection,
  Doc,
  Instrument,
  Module,
  ModularInstrument,
  ModuleType,
  OscInstrument,
  Pattern,
  Port,
  Track,
} from './types'
import { defaultParams } from './moduleDefs'

/**
 * Collision-free id, safe across save/load. A session-local counter would
 * restart at 0 when a saved doc is reloaded and collide with the loaded ids,
 * so we use a UUID (prefixed only for human readability in the JSON).
 */
export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export function emptyCells(length: number): Cell[] {
  return Array.from({ length }, () => ({ note: null }))
}

/** Fit a cell list to a target length: truncate if longer, pad empty if shorter. */
export function fitCells(cells: Cell[], length: number): Cell[] {
  const out = cells.slice(0, length).map((c) => ({ ...c }))
  while (out.length < length) out.push({ note: null })
  return out
}

/** A fresh saw instrument. */
export function newOscInstrument(name: string): OscInstrument {
  return { id: makeId('inst'), kind: 'osc', name, params: { gain: 0.8 } }
}

function newModule(type: ModuleType, x: number, y: number): Module {
  return { id: makeId('mod'), type, params: defaultParams(type), pos: { x, y } }
}

function connect(from: Port, to: Port, gain = 1): Connection {
  return { id: makeId('con'), from, to, gain }
}

/**
 * A fresh modular instrument seeded with a classic subtractive voice so it makes
 * sound the moment a track points at it: Note→Osc→Filter→Gain and
 * Gate→ADSR→(Gain mod), Gain→Output.
 */
export function newModularInstrument(name: string): ModularInstrument {
  const note = newModule('note', 40, 40)
  const gate = newModule('gate', 40, 240)
  const osc = newModule('osc', 260, 40)
  const filter = newModule('filter', 480, 40)
  const adsr = newModule('adsr', 260, 240)
  const gain = newModule('gain', 720, 140)
  const output = newModule('output', 960, 160)

  const modules = [note, gate, osc, filter, adsr, gain, output]
  const connections = [
    connect({ moduleId: note.id, port: 'freq' }, { moduleId: osc.id, port: 'freq' }),
    connect({ moduleId: osc.id, port: 'out' }, { moduleId: filter.id, port: 'in' }),
    connect({ moduleId: filter.id, port: 'out' }, { moduleId: gain.id, port: 'in' }),
    connect({ moduleId: gate.id, port: 'gate' }, { moduleId: adsr.id, port: 'gate' }),
    connect({ moduleId: adsr.id, port: 'env' }, { moduleId: gain.id, port: 'mod' }),
    connect({ moduleId: gain.id, port: 'out' }, { moduleId: output.id, port: 'inL' }),
  ]

  return {
    id: makeId('inst'),
    kind: 'modular',
    name,
    modules: Object.fromEntries(modules.map((m) => [m.id, m])),
    connections: Object.fromEntries(connections.map((c) => [c.id, c])),
    outputId: output.id,
  }
}

/**
 * Deep-clone an instrument with fresh ids. For modular instruments every module
 * and connection gets a new id and all `Port.moduleId` references (and
 * `outputId`) are remapped, so the copy is fully independent of the original.
 */
export function cloneInstrument(inst: Instrument, name: string): Instrument {
  if (inst.kind === 'osc') {
    return { id: makeId('inst'), kind: 'osc', name, params: { ...inst.params } }
  }

  const idMap = new Map<string, string>()
  for (const oldId of Object.keys(inst.modules)) idMap.set(oldId, makeId('mod'))
  const remap = (p: Port): Port => ({ moduleId: idMap.get(p.moduleId)!, port: p.port })

  const modules: Record<string, Module> = {}
  for (const m of Object.values(inst.modules)) {
    const id = idMap.get(m.id)!
    modules[id] = { id, type: m.type, params: { ...m.params }, pos: { ...m.pos } }
  }
  const connections: Record<string, Connection> = {}
  for (const c of Object.values(inst.connections)) {
    const id = makeId('con')
    connections[id] = { id, from: remap(c.from), to: remap(c.to), gain: c.gain }
  }
  return {
    id: makeId('inst'),
    kind: 'modular',
    name,
    modules,
    connections,
    outputId: idMap.get(inst.outputId)!,
  }
}

/** A fresh empty track bound to an instrument. */
export function newTrack(instrumentId: string, length: number): Track {
  return { id: makeId('trk'), instrumentId, cells: emptyCells(length) }
}

/**
 * A minimal starter document: one 16-row pattern, two saw tracks, with a few
 * notes already placed so playback makes sound the moment you hit play.
 */
export function createDefaultDoc(): Doc {
  const instA: Instrument = { id: makeId('inst'), kind: 'osc', name: 'Saw Lead', params: { gain: 0.8 } }
  const instB: Instrument = { id: makeId('inst'), kind: 'osc', name: 'Saw Bass', params: { gain: 0.8 } }

  const length = 16

  const trackA: Track = { id: makeId('trk'), instrumentId: instA.id, cells: emptyCells(length) }
  const trackB: Track = { id: makeId('trk'), instrumentId: instB.id, cells: emptyCells(length) }

  // A simple arpeggio on track A (C4 E4 G4 C5 pattern every 4 rows).
  const arp = [60, 64, 67, 72]
  for (let row = 0; row < length; row += 4) {
    trackA.cells[row].note = arp[(row / 4) % arp.length]
  }
  // A root-note bass on track B every 8 rows (C2 / G2).
  trackB.cells[0].note = 36
  trackB.cells[8].note = 43

  const pattern: Pattern = {
    id: makeId('pat'),
    name: 'Pattern 01',
    length,
    trackIds: [trackA.id, trackB.id],
  }

  return {
    entities: {
      instruments: { [instA.id]: instA, [instB.id]: instB },
      tracks: { [trackA.id]: trackA, [trackB.id]: trackB },
      patterns: { [pattern.id]: pattern },
    },
    patternId: pattern.id,
  }
}
