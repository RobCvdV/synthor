import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileModular } from './modular'
import { compileChannelEffects } from './mixer'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ChannelEffect, type ModularInstrument } from '../domain/types'

/** A minimal patch: gate → gain(sourceLevel) → comp.in → output.inL. */
function makeCompPatch(params: Record<string, number>, sourceLevel = 1): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
      g1: { id: 'g1', type: 'gain', params: { level: sourceLevel }, pos: { x: 0, y: 0 } },
      cp: { id: 'cp', type: 'comp', params, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'g1', port: 'in' }, gain: 1 },
      c2: { id: 'c2', from: { moduleId: 'g1', port: 'out' }, to: { moduleId: 'cp', port: 'in' }, gain: 1 },
      c3: { id: 'c3', from: { moduleId: 'cp', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
    },
    outputId: 'out',
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
  }
}

const DEFAULT_COMP: Record<string, number> = {
  bypass: 0, mode: 1, threshold: -20, ratio: 4, attack: 10, release: 100, knee: 6, makeup: 0,
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

const compile = (inst: ModularInstrument, paramRefs?: ReturnType<typeof mockParamRefs>) =>
  compileModular(
    inst, el.const({ value: 440 }), el.const({ value: 1 }), 'voice',
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

/** Render offline until the detector settles; return the last block's mean. */
async function renderSettled(pair: { left: NodeRepr_t; right: NodeRepr_t }): Promise<{ l: number; r: number }> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 256, sampleRate: 44100 })
  await r.render(pair.left, pair.right)
  const L = new Float32Array(256)
  const R = new Float32Array(256)
  r.process([], [L, R]) // warm-up block
  for (let i = 0; i < 16; i++) r.process([], [L, R])
  let l = 0
  let rSum = 0
  for (let i = 0; i < 256; i++) {
    l += L[i]
    rSum += R[i]
  }
  return { l: l / 256, r: rSum / 256 }
}

describe('compressor module', () => {
  it('bypass returns the input directly (no detector in the graph)', () => {
    const { left } = compile(makeCompPatch({ ...DEFAULT_COMP, bypass: 1 }))
    const kinds = new Set<string>()
    walkAll(left, (n) => kinds.add(n.kind as string))
    expect(kinds.has('env')).toBe(false)
  })

  it('registers live refs for all seven params', () => {
    const refs = mockParamRefs()
    compile(makeCompPatch(DEFAULT_COMP), refs)
    for (const key of ['mode', 'threshold', 'ratio', 'attack', 'release', 'knee', 'makeup']) {
      expect(refs.keys.has(`i1:cp:${key}`)).toBe(true)
    }
  })

  it('soft knee: 0 dB source, −20 dB threshold, 4:1 → ≈ −15 dB reduction', async () => {
    const { left, right } = compile(makeCompPatch(DEFAULT_COMP))
    const { l } = await renderSettled({ left, right })
    // GR = (1 − 1/4) · (0 − (−20)) = 15 dB → 10^(−15/20) ≈ 0.178.
    expect(l).toBeCloseTo(0.178, 1)
  })

  it('makeup gain lifts the compressed output by its dB value', async () => {
    const plain = compile(makeCompPatch(DEFAULT_COMP))
    const boosted = compile(makeCompPatch({ ...DEFAULT_COMP, makeup: 12 }))
    const a = await renderSettled(plain)
    const b = await renderSettled(boosted)
    expect(b.l).toBeCloseTo(0.708, 1)
    expect(b.l / a.l).toBeCloseTo(Math.pow(10, 12 / 20), 1)
  })

  it('hard knee: a signal exactly at the threshold is untouched', async () => {
    const { left, right } = compile(makeCompPatch({ ...DEFAULT_COMP, mode: 0 }, 0.1))
    const { l } = await renderSettled({ left, right })
    expect(l).toBeCloseTo(0.1, 2)
  })

  it('soft knee attenuates more gently than hard knee near the threshold', async () => {
    const hard = compile(makeCompPatch({ ...DEFAULT_COMP, mode: 0 }, 0.1))
    const soft = compile(makeCompPatch({ ...DEFAULT_COMP, mode: 1 }, 0.1))
    const h = await renderSettled(hard)
    const s = await renderSettled(soft)
    // Soft-knee GR = (1−¼)·3²/(2·6) dB = 0.5625 dB → ≈ 0.0937.
    expect(s.l).toBeCloseTo(0.0937, 2)
    expect(s.l).toBeLessThan(h.l)
  })

  it('knee 0 in soft mode stays finite (clamped inside the graph)', async () => {
    const { left, right } = compile(makeCompPatch({ ...DEFAULT_COMP, mode: 1, knee: 0 }))
    const { l } = await renderSettled({ left, right })
    expect(Number.isFinite(l)).toBe(true)
    // Clamped knee keeps the hard gain path at this level: same 0.178.
    expect(l).toBeCloseTo(0.178, 1)
  })
})

describe('compressor as a mixer channel effect', () => {
  const fx = (params: Record<string, number>): ChannelEffect => ({ id: 'chef_x', type: 'comp', params })
  const compileFx = (params: Record<string, number>, refs = mockParamRefs()) => {
    const out = compileChannelEffects(
      [fx(params)],
      { left: el.const({ value: 0.6 }), right: el.const({ value: 0.05 }) },
      'chan_1',
      refs as never,
    )
    return { out, refs }
  }

  it('registers chan-scoped refs for all params', () => {
    const { refs } = compileFx(DEFAULT_COMP)
    for (const key of ['bypass', 'mode', 'threshold', 'ratio', 'attack', 'release', 'knee', 'makeup']) {
      expect(refs.keys.has(`chan:chan_1:chef_x:${key}`)).toBe(true)
    }
  })

  it('links L/R detection: the quiet right channel is attenuated too', async () => {
    const { out } = compileFx(DEFAULT_COMP)
    const { l, r } = await renderSettled(out)
    // Shared sidechain (0.6 + 0.05)/2 = 0.325 → −9.77 dB → GR ≈ 7.67 dB.
    expect(l).toBeCloseTo(0.248, 1)
    // R alone (−26 dB) is below threshold, yet follows the shared detector.
    expect(r).toBeLessThan(0.05)
    expect(r).toBeCloseTo(0.021, 1)
  })

  it('makeup scales both channels', async () => {
    const { out } = compileFx({ ...DEFAULT_COMP, makeup: 12 })
    const { l, r } = await renderSettled(out)
    expect(l).toBeCloseTo(0.248 * Math.pow(10, 12 / 20), 1)
    expect(r).toBeCloseTo(0.021 * Math.pow(10, 12 / 20), 1)
  })

  it('bypass passes the signal through untouched', async () => {
    const { out } = compileFx({ ...DEFAULT_COMP, bypass: 1 })
    const { l, r } = await renderSettled(out)
    expect(l).toBeCloseTo(0.6, 2)
    expect(r).toBeCloseTo(0.05, 2)
  })
})
