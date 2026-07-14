import { describe, expect, it } from 'vitest'
import { compileModular, type StereoOut } from './modular'
import { newModularInstrument } from '../domain/factory'
import type { ModularInstrument } from '../domain/types'

function mono(out: StereoOut) {
  return out.left
}

// --- Elementary node introspection (same shape as compile.test.ts) --------
interface ElNode {
  symbol: string
  hash: number
  kind: string
  props: Record<string, unknown>
  children: unknown
}
function isNode(x: unknown): x is ElNode {
  return typeof x === 'object' && x !== null && (x as { symbol?: unknown }).symbol === '__ELEM_NODE__'
}
function childArray(children: unknown): unknown[] {
  const out: unknown[] = []
  let c: unknown = children
  while (typeof c === 'object' && c !== null && 'hd' in c) {
    const cell = c as unknown as { hd: unknown; tl: unknown }
    out.push(cell.hd)
    c = cell.tl
  }
  return out
}
function collect(root: unknown, kind: string): ElNode[] {
  const found: ElNode[] = []
  const seen = new Set<ElNode>()
  const walk = (n: unknown) => {
    if (!isNode(n) || seen.has(n)) return
    seen.add(n)
    if (n.kind === kind) found.push(n)
    for (const ch of childArray(n.children)) walk(ch)
  }
  walk(root)
  return found
}

describe('compileModular', () => {
  const m = (inst: ModularInstrument, freq = 440, gate = 1) =>
    mono(compileModular(inst, freq, gate))

  it('compiles the seeded default patch into a real subtractive voice', () => {
    const inst = newModularInstrument('Test')
    const node = m(inst)
    expect(collect(node, 'blepsaw').length).toBe(1)
    expect(collect(node, 'svf').length).toBe(1)
    expect(collect(node, 'mul').length).toBeGreaterThan(0)
  })

  it('gives the filter a stable key so param edits reconcile in place', () => {
    const inst = newModularInstrument('Test')
    const filterId = Object.values(inst.modules).find((m) => m.type === 'filter')!.id

    const before = collect(m(inst), 'svf')[0]
    const edited: ModularInstrument = {
      ...inst,
      modules: {
        ...inst.modules,
        [filterId]: { ...inst.modules[filterId], params: { ...inst.modules[filterId].params, cutoff: 800 } },
      },
    }
    const after = collect(m(edited), 'svf')[0]

    expect(before.props.key).toBe(after.props.key)
    expect(before.props.key).toBe(`${inst.id}:${filterId}`)
  })

  it('selects the oscillator waveform from the osc param', () => {
    const inst = newModularInstrument('Test')
    const oscId = Object.values(inst.modules).find((m) => m.type === 'osc')!.id
    const square: ModularInstrument = {
      ...inst,
      modules: { ...inst.modules, [oscId]: { ...inst.modules[oscId], params: { ...inst.modules[oscId].params, waveform: 1 } } },
    }
    const node = m(square)
    expect(collect(node, 'blepsquare').length).toBe(1)
    expect(collect(node, 'blepsaw').length).toBe(0)
  })

  it('returns silence for an empty output (nothing connected)', () => {
    const inst = newModularInstrument('Test')
    const bare: ModularInstrument = { ...inst, connections: {} }
    const node = m(bare)
    const consts = collect(node, 'const')
    expect(consts.some((c) => c.props.value === 0)).toBe(true)
  })

  it('breaks a cycle instead of recursing forever', () => {
    const inst: ModularInstrument = {
      id: 'inst_cycle',
      kind: 'modular',
      name: 'Cycle',
      modules: {
        a: { id: 'a', type: 'gain', params: { level: 1 }, pos: { x: 0, y: 0 } },
        b: { id: 'b', type: 'gain', params: { level: 1 }, pos: { x: 0, y: 0 } },
        out: { id: 'out', type: 'output', params: {}, pos: { x: 0, y: 0 } },
      },
      connections: {
        c1: { id: 'c1', from: { moduleId: 'a', port: 'out' }, to: { moduleId: 'b', port: 'in' }, gain: 1 },
        c2: { id: 'c2', from: { moduleId: 'b', port: 'out' }, to: { moduleId: 'a', port: 'in' }, gain: 1 },
        c3: { id: 'c3', from: { moduleId: 'a', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
      },
      outputId: 'out',
    }
    expect(() => compileModular(inst, 440, 1)).not.toThrow()
  })
})
