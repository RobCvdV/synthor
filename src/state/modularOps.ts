import type { Connection, Id, Module, ModuleType, Port } from '../domain/types'
import { defaultParams, MODULE_DEFS } from '../domain/moduleDefs'
import { makeId, nextEffName } from '../domain/factory'
import { updateParamRef } from '../audio/paramRefs'
import type { DocState } from './docStore'

export interface ModularOps {
  addModule: (instrumentId: Id, type: ModuleType, pos: { x: number; y: number }) => void
  /** Rename an `eff` inlet. Lanes on tracks using this instrument that
   *  referenced the old name follow the rename (name-based matching). */
  renameModule: (instrumentId: Id, moduleId: Id, name: string) => void
  removeModule: (instrumentId: Id, moduleId: Id) => void
  moveModule: (instrumentId: Id, moduleId: Id, pos: { x: number; y: number }) => void
  /** Batch-move multiple modules in one undo step (multi-node drag stop). */
  moveModules: (instrumentId: Id, moves: Array<{ id: Id; pos: { x: number; y: number } }>) => void
  setModuleParam: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  /** Update param ref immediately without triggering a recompile.
   *  Use during slider drags for smooth audio; call setModuleParamSilent
   *  on drag-end to persist the value in the store without triggering compile. */
  setModuleParamFast: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  /** Persist a module param to the store + undo history WITHOUT triggering
   *  a graph recompile. Use on slider mouseUp after the fast path already
   *  updated the ref. */
  setModuleParamSilent: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  addConnection: (instrumentId: Id, from: Port, to: Port, stack?: boolean) => void
  removeConnection: (instrumentId: Id, connectionId: Id) => void
  setConnectionGain: (instrumentId: Id, connectionId: Id, gain: number) => void
  /** Ensure a modular instrument has its singleton source modules (effect1/2 etc.).
   *  Idempotent — only adds modules that are missing. Called on editor mount so
   *  existing patches get new source modules automatically. */
  ensureModularSingletons: (instrumentId: Id) => void
  /** Remove a batch of modules (and their incident connections) in one undo step. */
  removeModules: (instrumentId: Id, moduleIds: Id[]) => void
  /** Paste a group of modules + connections in one undo step. */
  pasteModules: (instrumentId: Id, modules: Module[], connections: Connection[]) => void
}

/**
 * Would adding a cord from `fromId`→`toId` create a cycle? True if `fromId` is
 * already reachable from `toId` by following existing cords (so the new edge
 * would close a loop). Keeps modular patches acyclic for the v1 compiler.
 */
function wouldCycle(
  connections: Record<Id, { from: Port; to: Port }>,
  fromId: Id,
  toId: Id,
): boolean {
  const adjacency = Object.values(connections)
  const stack = [toId]
  const seen = new Set<Id>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === fromId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const c of adjacency) {
      if (c.from.moduleId === cur) stack.push(c.to.moduleId)
    }
  }
  return false
}

export function modularOps(get: () => DocState): ModularOps {
  return {
    addModule: (instrumentId, type, pos) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        // Sources (note/gate) and the output sink are singletons — one per patch.
        if (MODULE_DEFS[type].singleton) return
        const id = makeId('mod')
        const mod: Module = { id, type, params: defaultParams(type), pos }
        // Named inlets need a unique name to be addressable from tracker lanes.
        if (type === 'eff') {
          mod.name = nextEffName(Object.values(inst.modules).map((m) => m.name ?? ''))
        }
        inst.modules[id] = mod
      }),

    renameModule: (instrumentId, moduleId, name) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const mod = inst.modules[moduleId]
        if (!mod || mod.type !== 'eff') return
        const trimmed = name.trim()
        if (!trimmed || trimmed === mod.name) return
        // Names must stay unique: two modules sharing a name share one lane.
        for (const other of Object.values(inst.modules)) {
          if (other.id !== moduleId && other.type === 'eff' && other.name === trimmed) return
        }
        const oldName = mod.name
        mod.name = trimmed
        // Follow renames through to lanes so existing automation keeps working.
        for (const track of Object.values(draft.entities.tracks)) {
          if (track.instrumentId !== instrumentId) continue
          for (const lane of track.effectLanes) {
            if (lane.type === oldName) lane.type = trimmed
          }
        }
      }),

    removeModule: (instrumentId, moduleId) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const mod = inst.modules[moduleId]
        // Never delete singletons (note/gate/output) — the patch depends on them.
        if (!mod || MODULE_DEFS[mod.type].singleton) return
        delete inst.modules[moduleId]
        for (const c of Object.values(inst.connections)) {
          if (c.from.moduleId === moduleId || c.to.moduleId === moduleId) {
            delete inst.connections[c.id]
          }
        }
      }),

    moveModule: (instrumentId, moduleId, pos) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const mod = inst.modules[moduleId]
        if (mod) mod.pos = pos
      }),

    moveModules: (instrumentId, moves) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        for (const { id, pos } of moves) {
          const mod = inst.modules[id]
          if (mod) mod.pos = pos
        }
      }),

    setModuleParamFast: (_instrumentId, _moduleId, key, value) => {
      // Only update the ref — no store mutation, no compile trigger.
      // Combine instrument+module+key the same way compileModular's kconst does.
      const refKey = `${_instrumentId}:${_moduleId}:${key}`
      updateParamRef(refKey, value)
    },

    setModuleParamSilent: (instrumentId, moduleId, key, value) => {
      get().mutateSilent((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const mod = inst.modules[moduleId]
        if (mod) mod.params[key] = value
      })
      // Ref already has this value from the fast path — updateParamRef is
      // a no-op here but included for safety.
      updateParamRef(`${instrumentId}:${moduleId}:${key}`, value)
    },

    setModuleParam: (instrumentId, moduleId, key, value) => {
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const mod = inst.modules[moduleId]
        if (mod) mod.params[key] = value
      })
      updateParamRef(`${instrumentId}:${moduleId}:${key}`, value)
    },

    addConnection: (instrumentId, from, to, stack = false) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        if (!inst.modules[from.moduleId] || !inst.modules[to.moduleId]) return
        // Reject cycles first — before mutating anything — so a rejected cord
        // doesn't drop the inlet's existing feeder.
        if (wouldCycle(inst.connections, from.moduleId, to.moduleId)) return
        // Exact duplicate adds nothing (same source into the same inlet twice).
        for (const c of Object.values(inst.connections)) {
          if (
            c.from.moduleId === from.moduleId && c.from.port === from.port &&
            c.to.moduleId === to.moduleId && c.to.port === to.port
          ) return
        }
        if (!stack) {
          // One cord per inlet: replace any existing feeder into this exact inlet.
          for (const c of Object.values(inst.connections)) {
            if (c.to.moduleId === to.moduleId && c.to.port === to.port) delete inst.connections[c.id]
          }
        }
        const id = makeId('con')
        inst.connections[id] = { id, from, to, gain: 1 }
      }),

    removeConnection: (instrumentId, connectionId) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        delete inst.connections[connectionId]
      }),

    setConnectionGain: (instrumentId, connectionId, gain) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const con = inst.connections[connectionId]
        if (con) con.gain = gain
      }),

    /** Ensure a modular instrument has its singleton source modules.
     *  No-op since eff modules replaced effect1/effect2 and are user-added. */
    ensureModularSingletons: (_instrumentId) => {
      // No-op: eff modules are now user-added (replaces old effect1/effect2 singletons).
    },

    removeModules: (instrumentId, moduleIds) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        const set = new Set(moduleIds)
        for (const mid of moduleIds) {
          const mod = inst.modules[mid]
          if (mod && !MODULE_DEFS[mod.type].singleton) delete inst.modules[mid]
        }
        for (const c of Object.values(inst.connections)) {
          if (set.has(c.from.moduleId) || set.has(c.to.moduleId)) {
            delete inst.connections[c.id]
          }
        }
      }),

    pasteModules: (instrumentId, modules, connections) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'modular') return
        // Pasted eff modules get fresh names so they don't collide with the
        // originals (lanes match inlets by name).
        const taken = new Set(Object.values(inst.modules).map((m) => m.name ?? ''))
        for (const m of modules) {
          if (MODULE_DEFS[m.type].singleton) continue
          if (m.type === 'eff') {
            const name = nextEffName(taken)
            taken.add(name)
            inst.modules[m.id] = { ...m, name }
          } else {
            inst.modules[m.id] = m
          }
        }
        for (const c of connections) {
          if (inst.modules[c.from.moduleId] && inst.modules[c.to.moduleId]) {
            inst.connections[c.id] = c
          }
        }
      }),
  }
}
