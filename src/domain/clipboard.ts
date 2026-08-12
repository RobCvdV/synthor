import type { Connection, Id, Module, ModularInstrument } from './types'
import { makeId } from './factory'
import { MODULE_DEFS } from './moduleDefs'

/** Clipboard for cut/copy of selected modules + their internal connections. */
export interface ModuleClipboard {
  modules: Module[]
  connections: Connection[]
}

/**
 * Collect non-singleton modules and internal connections for a set of
 * selected node ids. Returns null when there's nothing to copy.
 */
export function collectClipboardModules(
  inst: ModularInstrument,
  selectedIds: Id[],
): ModuleClipboard | null {
  const ids = new Set(selectedIds)
  const mods = Object.values(inst.modules).filter(
    (m) => ids.has(m.id) && !MODULE_DEFS[m.type].singleton,
  )
  if (mods.length === 0) return null
  const conns = Object.values(inst.connections).filter(
    (c) => ids.has(c.from.moduleId) && ids.has(c.to.moduleId),
  )
  return { modules: mods, connections: conns }
}

/**
 * Assign fresh ids to every module and connection in a clipboard group
 * and remap all port references, so the pasted group is independent of the
 * original. Positions are offset by +44 so the pasted group is visible.
 */
export function preparePastedModules(
  clip: ModuleClipboard,
): { modules: Module[]; connections: Connection[] } {
  const idMap = new Map<Id, Id>()
  const modules: Module[] = clip.modules.map((m) => {
    const newId = makeId('mod')
    idMap.set(m.id, newId)
    return { ...m, id: newId, params: { ...m.params }, pos: { x: m.pos.x + 44, y: m.pos.y + 44 } }
  })
  const connections: Connection[] = clip.connections.map((c) => ({
    id: makeId('con'),
    from: { moduleId: idMap.get(c.from.moduleId) ?? c.from.moduleId, port: c.from.port },
    to: { moduleId: idMap.get(c.to.moduleId) ?? c.to.moduleId, port: c.to.port },
    gain: c.gain,
  }))
  return { modules, connections }
}

/**
 * Collect deletable (non-singleton) module ids from a selection.
 */
export function collectDeletableIds(
  inst: ModularInstrument,
  selectedIds: Id[],
): Id[] {
  const ids = new Set(selectedIds)
  return Object.keys(inst.modules).filter(
    (id) => ids.has(id) && !MODULE_DEFS[inst.modules[id].type].singleton,
  )
}
