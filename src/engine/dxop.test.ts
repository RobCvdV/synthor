import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileModular } from './modular'
import { buildDxAlgorithm } from '../domain/factory'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** A minimal patch: one dxop → output.inL. */
function makeDxPatch(params: Record<string, number>): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      op: { id: 'op', type: 'dxop', params, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'op', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
    },
    outputId: 'out',
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
  }
}

/** Minimal mock of ParamRefRegistry — records keys and returns el.const nodes. */
function mockParamRefs() {
  const keys = new Set<string>()
  return {
    keys,
    getOrCreate(key: string, value: number) {
      keys.add(key)
      return el.const({ key, value })
    },
  }
}

const compile = (inst: ModularInstrument, voiceHz = 440, paramRefs?: ReturnType<typeof mockParamRefs>) =>
  compileModular(
    inst, el.const({ value: voiceHz }), el.const({ value: 1 }), 'voice',
    [], 1, {}, undefined, paramRefs as never,
  )

/** Visit every Elementary node in a repr tree (see delayTime.test.ts). */
function walkAll(n: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!n || typeof n !== 'object') return
  const node = n as Record<string, unknown>
  if (node.symbol === '__ELEM_NODE__') visit(node)
  const children = node.children
  if (Array.isArray(children)) {
    for (const c of children) walkAll(c, visit)
    return
  }
  if (children && children !== 0) {
    const pair = children as Record<string, unknown>
    walkAll(pair.hd, visit)
    walkAll(pair.tl, visit)
    return
  }
  walkAll(node.hd, visit)
  walkAll(node.tl, visit)
}

/** Render a stereo pair offline for `blocks` blocks, return left samples. */
async function renderBlocks(pair: { left: NodeRepr_t; right: NodeRepr_t }, blocks = 6): Promise<Float32Array> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 256, sampleRate: 44100 })
  await r.render(pair.left, pair.right)
  const all = new Float32Array(blocks * 256)
  const L = new Float32Array(256)
  const R = new Float32Array(256)
  for (let b = 0; b < blocks; b++) {
    r.process([], [L, R])
    all.set(L, b * 256)
  }
  return all
}

/** Sign-flip count — estimates the fundamental frequency of the rendered tone. */
function zeroCrossings(buf: Float32Array): number {
  let count = 0
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i - 1] >= 0) !== (buf[i] >= 0)) count++
  }
  return count
}

describe('dxop module', () => {
  it('builds PM structure: phasor, sin, and matched tapIn/tapOut feedback', () => {
    const { left } = compile(makeDxPatch({ feedback: 0.3 }))
    const kinds = new Set<string>()
    const taps: Array<{ kind: string; name: string }> = []
    walkAll(left, (n) => {
      kinds.add(n.kind as string)
      if (n.kind === 'tapIn' || n.kind === 'tapOut') {
        taps.push({ kind: n.kind as string, name: (n.props as Record<string, unknown>).name as string })
      }
    })
    expect(kinds).toContain('phasor')
    expect(kinds).toContain('sin')
    expect(kinds).toContain('tapIn')
    expect(kinds).toContain('tapOut')
    expect(taps.map((t) => `${t.kind}:${t.name}`).sort()).toEqual([
      'tapIn:voice:op:fb',
      'tapOut:voice:op:fb',
    ])
  })

  it('registers live refs for freqMode, ratio, fixedHz, feedback, level', () => {
    const refs = mockParamRefs()
    compile(makeDxPatch({}), 440, refs)
    for (const p of ['freqMode', 'ratio', 'fixedHz', 'feedback', 'level']) {
      expect(refs.keys.has(`i1:op:${p}`)).toBe(true)
    }
  })

  it('ratio mode scales the voice frequency (ratio 2 → one octave up)', async () => {
    const { left, right } = compile(makeDxPatch({ ratio: 2 }), 440)
    const out = await renderBlocks({ left, right })
    // 880 Hz over 1536 samples @ 44.1 kHz ≈ 61 crossings; 440 Hz would be ≈ 31.
    expect(zeroCrossings(out)).toBeGreaterThan(48)
  })

  it('fixed mode ignores the voice frequency', async () => {
    const { left, right } = compile(makeDxPatch({ freqMode: 1, fixedHz: 440 }), 880)
    const out = await renderBlocks({ left, right })
    // If it tracked the 880 Hz voice it would cross ≈ 61 times; 440 Hz ≈ 31.
    expect(zeroCrossings(out)).toBeLessThan(48)
  })

  it('renders finite, stable output with feedback', async () => {
    const { left, right } = compile(makeDxPatch({ feedback: 0.6 }))
    const out = await renderBlocks({ left, right })
    let max = 0
    for (const x of out) {
      expect(Number.isFinite(x)).toBe(true)
      max = Math.max(max, Math.abs(x))
    }
    expect(max).toBeGreaterThan(0.1)
    expect(max).toBeLessThan(2)
  })

  it('sums mod cords and keeps feedback taps per module', () => {
    const inst: ModularInstrument = {
      id: 'i1', kind: 'modular', name: 'Test',
      modules: {
        op1: { id: 'op1', type: 'dxop', params: { ratio: 1 }, pos: { x: 0, y: 0 } },
        op2: { id: 'op2', type: 'dxop', params: { ratio: 2 }, pos: { x: 0, y: 0 } },
        out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
      },
      connections: {
        c1: { id: 'c1', from: { moduleId: 'op2', port: 'out' }, to: { moduleId: 'op1', port: 'mod' }, gain: 0.7 },
        c2: { id: 'c2', from: { moduleId: 'op1', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
      },
      outputId: 'out',
      effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
      channelId: MASTER_CHANNEL_ID,
      pan: 0,
    }
    const { left } = compile(inst)
    const taps = new Set<string>()
    walkAll(left, (n) => {
      if (n.kind === 'tapIn' || n.kind === 'tapOut') {
        taps.add((n.props as Record<string, unknown>).name as string)
      }
    })
    expect(taps).toEqual(new Set(['voice:op1:fb', 'voice:op2:fb']))
  })

  it('algorithm preset is silent with the gate closed and sounds when opened', async () => {
    // Regression: the preset used to wire carriers straight to the output,
    // so the always-on operators droned even without notes playing.
    const inst: ModularInstrument = {
      id: 'i1', kind: 'modular', name: 'Preset',
      modules: {
        gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
        out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
      },
      connections: {},
      outputId: 'out',
      effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
      channelId: MASTER_CHANNEL_ID,
      pan: 0,
    }
    const { modules, connections } = buildDxAlgorithm(1, 'out', 'gate', { x: 0, y: 0 })
    for (const m of modules) inst.modules[m.id] = m
    for (const c of connections) inst.connections[c.id] = c

    const withGate = (gate: number) =>
      compileModular(
        inst, el.const({ value: 440 }), el.const({ value: gate }), 'voice',
        [], 1, {}, undefined, undefined,
      )

    const silent = await renderBlocks(withGate(0), 4)
    for (const x of silent) expect(x).toBe(0)

    const sounding = await renderBlocks(withGate(1), 8)
    let max = 0
    for (const x of sounding) {
      expect(Number.isFinite(x)).toBe(true)
      max = Math.max(max, Math.abs(x))
    }
    expect(max).toBeGreaterThan(0.01)
  })
})
