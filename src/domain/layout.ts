/**
 * Auto-layout for the modular editor: dagre ranks the module graph left to
 * right (the patch's signal-flow direction) and returns top-left positions
 * for React Flow. Pure data in, pure data out — the editor owns the store.
 */

import dagre from '@dagrejs/dagre'
import type { Connection, Id, Module } from './types'
import { MODULE_DEFS } from './moduleDefs'

export interface ModuleSize {
  width: number
  height: number
}

export interface LayoutedModule {
  id: Id
  pos: { x: number; y: number }
}

export interface LayoutOpts {
  ranksep?: number
  nodesep?: number
  /** Translate the result so its bounding-box top-left lands here (default origin). */
  anchor?: { x: number; y: number }
}

// `.mod-node` renders with a fixed width; the row metrics mirror the ModuleNode
// renderer so the estimate is a close stand-in for a not-yet-measured node.
const NODE_WIDTH = 176
const HEADER_H = 29
const BODY_PAD = 8
const PORT_ROW_H = 24
const PARAM_ROW_H = 42
const SCOPE_ROW_H = 42

/** Fallback node size derived from the module def, matching the renderer's
 *  row rules (scale params, bypass and hidden pulseWidth take no body row). */
export function estimateModuleSize(m: Module): ModuleSize {
  const def = MODULE_DEFS[m.type]
  const wfDef = def.params.find((p) => p.key === 'waveform')
  const pulseIdx = wfDef?.enumLabels?.indexOf('pulse') ?? -1
  let rows = 0
  for (const p of def.params) {
    if (p.key.endsWith('Scale') || p.key === 'bypass') continue
    if (p.key === 'pulseWidth') {
      const wf = m.params.waveform ?? wfDef?.default ?? 0
      if (pulseIdx < 0 || Math.round(wf) !== pulseIdx) continue
    }
    rows++
  }
  return {
    width: NODE_WIDTH,
    height:
      HEADER_H +
      BODY_PAD +
      Math.max(def.inlets.length, def.outlets.length) * PORT_ROW_H +
      rows * PARAM_ROW_H +
      (m.type === 'output' ? SCOPE_ROW_H : 0),
  }
}

/**
 * Lay out modules left to right with dagre, using `getSize` for node
 * dimensions. Only connections between included modules take part; cycles
 * and disconnected groups are tolerated. Output is bbox-normalized and then
 * translated to `opts.anchor` (or the origin).
 */
export function computeModuleLayout(
  modules: Module[],
  connections: Connection[],
  getSize: (id: Id) => ModuleSize,
  opts: LayoutOpts = {},
): LayoutedModule[] {
  if (modules.length === 0) return []
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    ranksep: opts.ranksep ?? 90,
    nodesep: opts.nodesep ?? 40,
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))
  const sizes = new Map<Id, ModuleSize>()
  for (const m of modules) {
    const size = getSize(m.id)
    sizes.set(m.id, size)
    // Zero dimensions make dagre's ranking degenerate — clamp defensively.
    g.setNode(m.id, { width: Math.max(size.width, 1), height: Math.max(size.height, 1) })
  }
  for (const c of connections) {
    if (!g.hasNode(c.from.moduleId) || !g.hasNode(c.to.moduleId)) continue
    g.setEdge(c.from.moduleId, c.to.moduleId)
  }
  dagre.layout(g)
  const laid: LayoutedModule[] = modules.map((m) => {
    const center = g.node(m.id) as { x: number; y: number }
    const size = sizes.get(m.id)!
    // Dagre positions node centers; React Flow wants top-left corners.
    return { id: m.id, pos: { x: center.x - size.width / 2, y: center.y - size.height / 2 } }
  })
  const minX = Math.min(...laid.map((l) => l.pos.x))
  const minY = Math.min(...laid.map((l) => l.pos.y))
  const dx = (opts.anchor?.x ?? 0) - minX
  const dy = (opts.anchor?.y ?? 0) - minY
  return laid.map((l) => ({ id: l.id, pos: { x: l.pos.x + dx, y: l.pos.y + dy } }))
}
