/**
 * A compact way to write modular patches in code (the factory presets). Ids are derived from the
 * preset id, so a preset builds the same instrument every time; inserting it into a song re-ids it.
 */
import { computeModuleLayout, estimateModuleSize } from '../layout'
import { defaultParams, MODULE_DEFS } from '../moduleDefs'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type Connection, type Module, type ModularInstrument, type ModuleType } from '../types'

/** A module in the patch being built; `.port(name)` picks a non-default outlet. */
export interface ModuleRef {
  id: string
  type: ModuleType
  port(name: string): PortRef
}

export interface PortRef {
  id: string
  port: string
}

export interface PatchBuilder {
  note: ModuleRef
  gate: ModuleRef
  /** The row's volume (0..1); the voice already applies it, so wire it only for extra effect. */
  volume: ModuleRef
  output: ModuleRef
  /** Adds a module; params not given keep the module's defaults. */
  add(type: ModuleType, params?: Record<string, number>, name?: string): ModuleRef
  /** Cords `from` (its first outlet unless a port is picked) into `to`'s `inlet`. */
  wire(from: ModuleRef | PortRef, to: ModuleRef, inlet: string, gain?: number): void
}

export interface PatchOptions {
  /** Live (free play) polyphony. */
  voices?: number
  /** Output module volume. */
  level?: number
}

export function buildPatch(id: string, name: string, opts: PatchOptions, body: (b: PatchBuilder) => void): ModularInstrument {
  const modules: Module[] = []
  const connections: Connection[] = []
  const counts = new Map<string, number>()

  const ref = (m: Module): ModuleRef => ({ id: m.id, type: m.type, port: (port) => ({ id: m.id, port }) })
  const add = (type: ModuleType, params: Record<string, number> = {}, label?: string): ModuleRef => {
    for (const key of Object.keys(params)) {
      if (!MODULE_DEFS[type].params.some((p) => p.key === key)) throw new Error(`${id}: ${type} has no param "${key}"`)
    }
    const n = (counts.get(type) ?? 0) + 1
    counts.set(type, n)
    const m: Module = { id: `${id}:${type}${n}`, type, params: { ...defaultParams(type), ...params }, pos: { x: 0, y: 0 } }
    if (label !== undefined) m.name = label
    modules.push(m)
    return ref(m)
  }

  const note = add('note')
  const gate = add('gate')
  const volume = add('volume')
  const output = add('output', opts.level !== undefined ? { gain: opts.level } : {})

  const wire = (from: ModuleRef | PortRef, to: ModuleRef, inlet: string, gain = 1) => {
    const src = 'type' in from ? { id: from.id, port: MODULE_DEFS[from.type].outlets[0] } : from
    const srcType = modules.find((m) => m.id === src.id)!.type
    if (!MODULE_DEFS[srcType].outlets.includes(src.port)) throw new Error(`${id}: ${srcType} has no outlet "${src.port}"`)
    if (!MODULE_DEFS[to.type].inlets.includes(inlet)) throw new Error(`${id}: ${to.type} has no inlet "${inlet}"`)
    connections.push({
      id: `${id}:c${connections.length + 1}`,
      from: { moduleId: src.id, port: src.port },
      to: { moduleId: to.id, port: inlet },
      gain,
    })
  }

  body({ note, gate, volume, output, add, wire })

  const laid = computeModuleLayout(modules, connections, (mid) => estimateModuleSize(modules.find((m) => m.id === mid)!), { anchor: { x: 40, y: 40 } })
  for (const { id: mid, pos } of laid) modules.find((m) => m.id === mid)!.pos = { x: Math.round(pos.x), y: Math.round(pos.y) }

  return {
    id,
    kind: 'modular',
    name,
    modules: Object.fromEntries(modules.map((m) => [m.id, m])),
    connections: Object.fromEntries(connections.map((c) => [c.id, c])),
    outputId: output.id,
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
    voices: opts.voices ?? 4,
  }
}
