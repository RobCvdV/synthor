import { describe, expect, it } from 'vitest'
import type { Connection, Module } from './types'
import { computeModuleLayout, estimateModuleSize } from './layout'
import { newModularInstrument } from './factory'

const mod = (id: string, type: Module['type'], params: Module['params'] = {}): Module => ({
  id,
  type,
  params,
  pos: { x: 0, y: 0 },
})

const con = (id: string, from: string, to: string): Connection => ({
  id,
  from: { moduleId: from, port: 'out' },
  to: { moduleId: to, port: 'in' },
  gain: 1,
})

const uniformSize = { width: 176, height: 100 }
const getSize = (sizes: Record<string, { width: number; height: number }>) => (id: string) =>
  sizes[id] ?? uniformSize

/** Every pair of laid-out bboxes must be disjoint (dagre guarantees this). */
function expectNoOverlap(
  laid: Array<{ id: string; pos: { x: number; y: number } }>,
  getSize: (id: string) => { width: number; height: number },
) {
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      const a = laid[i]
      const b = laid[j]
      const sa = getSize(a.id)
      const sb = getSize(b.id)
      const apart =
        a.pos.x + sa.width <= b.pos.x ||
        b.pos.x + sb.width <= a.pos.x ||
        a.pos.y + sa.height <= b.pos.y ||
        b.pos.y + sb.height <= a.pos.y
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
    }
  }
}

describe('estimateModuleSize', () => {
  it('mirrors the renderer row rules', () => {
    // gate: no params, one outlet → header + pad + one port row.
    expect(estimateModuleSize(mod('g', 'gate'))).toEqual({ width: 176, height: 61 })
    // filter: mode/cutoff/q/modDepth render as rows; bypass + modDepthScale don't.
    expect(estimateModuleSize(mod('f', 'filter'))).toEqual({ width: 176, height: 253 })
    // osc shows pulseWidth only on the pulse waveform (index 4).
    const saw = estimateModuleSize(mod('o', 'osc', { waveform: 0 }))
    const pulse = estimateModuleSize(mod('o', 'osc', { waveform: 4 }))
    expect(pulse.height).toBe(saw.height + 42)
    // output: one param row plus the scope canvas.
    const out = estimateModuleSize(mod('o2', 'output'))
    const gain = estimateModuleSize(mod('g2', 'gain'))
    expect(out.height).toBeGreaterThan(gain.height)
  })
})

describe('computeModuleLayout', () => {
  it('ranks a chain left to right with no overlaps', () => {
    const sizes = { a: { width: 176, height: 80 }, b: { width: 176, height: 200 }, c: { width: 176, height: 120 } }
    const laid = computeModuleLayout(
      [mod('a', 'gain'), mod('b', 'filter'), mod('c', 'gain')],
      [con('ab', 'a', 'b'), con('bc', 'b', 'c')],
      getSize(sizes),
    )
    const pos = Object.fromEntries(laid.map((l) => [l.id, l.pos]))
    expect(pos.a.x).toBeLessThan(pos.b.x)
    expect(pos.b.x).toBeLessThan(pos.c.x)
    expectNoOverlap(laid, getSize(sizes))
    // bbox-normalized to the origin when no anchor is given.
    expect(Math.min(...laid.map((l) => l.pos.x))).toBe(0)
    expect(Math.min(...laid.map((l) => l.pos.y))).toBe(0)
  })

  it('translates the bbox top-left to the anchor', () => {
    const laid = computeModuleLayout(
      [mod('a', 'gain'), mod('b', 'gain')],
      [con('ab', 'a', 'b')],
      getSize({}),
      { anchor: { x: 500, y: 300 } },
    )
    expect(Math.min(...laid.map((l) => l.pos.x))).toBe(500)
    expect(Math.min(...laid.map((l) => l.pos.y))).toBe(300)
  })

  it('lays out the seeded patch along the signal flow', () => {
    const inst = newModularInstrument('Lead')
    const all = Object.values(inst.modules)
    const laid = computeModuleLayout(all, Object.values(inst.connections), (id) =>
      estimateModuleSize(inst.modules[id]),
    )
    const pos = Object.fromEntries(laid.map((l) => [l.id, l.pos]))
    const byType = (type: Module['type']) => {
      const m = all.find((x) => x.type === type)!
      return pos[m.id].x
    }
    expect(byType('note')).toBeLessThan(byType('osc'))
    expect(byType('osc')).toBeLessThan(byType('filter'))
    expect(byType('filter')).toBeLessThan(byType('gain'))
    expect(byType('gain')).toBeLessThan(byType('output'))
    expect(byType('gate')).toBeLessThan(byType('adsr'))
    expectNoOverlap(laid, (id) => estimateModuleSize(inst.modules[id]))
  })

  it('tolerates cycles', () => {
    const laid = computeModuleLayout(
      [mod('a', 'gain'), mod('b', 'gain')],
      [con('ab', 'a', 'b'), con('ba', 'b', 'a')],
      getSize({}),
    )
    expect(laid).toHaveLength(2)
    for (const l of laid) {
      expect(Number.isFinite(l.pos.x)).toBe(true)
      expect(Number.isFinite(l.pos.y)).toBe(true)
    }
  })

  it('stacks disconnected nodes without overlap', () => {
    const laid = computeModuleLayout([mod('a', 'gain'), mod('b', 'gain')], [], getSize({}))
    expectNoOverlap(laid, getSize({}))
  })

  it('handles single, duplicate-edge and empty inputs', () => {
    expect(computeModuleLayout([], [], getSize({}))).toEqual([])
    const single = computeModuleLayout([mod('a', 'gain')], [], getSize({}))
    expect(single).toEqual([{ id: 'a', pos: { x: 0, y: 0 } }])
    const dup = computeModuleLayout(
      [mod('a', 'gain'), mod('b', 'gain')],
      [con('ab1', 'a', 'b'), con('ab2', 'a', 'b')],
      getSize({}),
    )
    expect(dup).toHaveLength(2)
  })
})
