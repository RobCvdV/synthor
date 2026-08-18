import type { Edge, Node } from '@xyflow/react'
import type { AudioHost } from '../audio/host'
import type { ModularInstrument } from '../domain/types'
import { round } from './format'

/** Doc → React Flow nodes for the modular editor canvas. */
export function buildNodes(inst: ModularInstrument, host?: AudioHost): Node[] {
  return Object.values(inst.modules).map((m) => ({
    id: m.id,
    type: 'module',
    position: { ...m.pos },
    data: { instrumentId: inst.id, moduleId: m.id, host: m.type === 'output' ? host : undefined },
  }))
}

/** Doc → React Flow edges for the modular editor canvas. */
export function buildEdges(inst: ModularInstrument): Edge[] {
  return Object.values(inst.connections).map((c) => ({
    id: c.id,
    source: c.from.moduleId,
    sourceHandle: c.from.port,
    target: c.to.moduleId,
    targetHandle: c.to.port,
    label: c.gain === 1 ? undefined : `×${round(c.gain)}`,
  }))
}
