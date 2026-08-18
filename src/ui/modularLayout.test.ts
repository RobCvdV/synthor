import { describe, expect, it } from 'vitest'
import { newModularInstrument } from '../domain/factory'
import type { AudioHost } from '../audio/host'
import { buildEdges, buildNodes } from './modularLayout'

const hostStub = { getLevel: () => 0 } as unknown as AudioHost

describe('buildNodes', () => {
  it('maps every module to a node', () => {
    const inst = newModularInstrument('Lead')
    const nodes = buildNodes(inst)
    expect(nodes).toHaveLength(Object.keys(inst.modules).length)
    for (const m of Object.values(inst.modules)) {
      const n = nodes.find((x) => x.id === m.id)
      expect(n).toBeDefined()
      expect(n!.type).toBe('module')
    }
  })

  it('copies position and wires instrumentId/moduleId', () => {
    const inst = newModularInstrument('Lead')
    for (const m of Object.values(inst.modules)) {
      const n = buildNodes(inst).find((x) => x.id === m.id)!
      expect(n.position).toEqual(m.pos)
      expect(n.data.instrumentId).toBe(inst.id)
      expect(n.data.moduleId).toBe(m.id)
    }
  })

  it('attaches the host only to the output module node', () => {
    const inst = newModularInstrument('Lead')
    const withHost = buildNodes(inst, hostStub)
    for (const m of Object.values(inst.modules)) {
      const n = withHost.find((x) => x.id === m.id)!
      if (m.type === 'output') expect(n.data.host).toBe(hostStub)
      else expect(n.data.host).toBeUndefined()
    }
    const withoutHost = buildNodes(inst)
    const out = withoutHost.find((x) => x.id === inst.outputId)!
    expect(out.data.host).toBeUndefined()
  })
})

describe('buildEdges', () => {
  it('maps every connection to an edge with source/target ports', () => {
    const inst = newModularInstrument('Lead')
    const edges = buildEdges(inst)
    expect(edges).toHaveLength(Object.keys(inst.connections).length)
    for (const e of edges) {
      const c = inst.connections[e.id]
      expect(e.source).toBe(c.from.moduleId)
      expect(e.sourceHandle).toBe(c.from.port)
      expect(e.target).toBe(c.to.moduleId)
      expect(e.targetHandle).toBe(c.to.port)
    }
  })

  it('omits the label at unity gain and formats otherwise', () => {
    const inst = newModularInstrument('Lead')
    const id = Object.keys(inst.connections)[0]
    inst.connections[id] = { ...inst.connections[id], gain: 0.5 }
    const edges = buildEdges(inst)
    expect(edges.find((e) => e.id === id)!.label).toBe('×0.5')
    expect(edges.filter((e) => e.id !== id).every((e) => e.label === undefined)).toBe(true)
  })
})
