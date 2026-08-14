import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileChannelEffects } from './mixer'
import { compileModular } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ChannelEffect, type ModularInstrument } from '../domain/types'

const DEFAULT_WIDTH: Record<string, number> = { bypass: 0, width: 1 }

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

const fx = (params: Record<string, number>): ChannelEffect => ({ id: 'chef_x', type: 'width', params })

const compileFx = (params: Record<string, number>, left: number, right: number, refs = mockParamRefs()) => {
  const out = compileChannelEffects(
    [fx(params)],
    { left: el.const({ value: left }), right: el.const({ value: right }) },
    'chan_1',
    refs as never,
  )
  return { out, refs }
}

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

/** Render offline and return the mean of the last settled block. */
async function renderSettled(pair: { left: NodeRepr_t; right: NodeRepr_t }): Promise<{ l: number; r: number }> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 256, sampleRate: 44100 })
  await r.render(pair.left, pair.right)
  const L = new Float32Array(256)
  const R = new Float32Array(256)
  r.process([], [L, R]) // warm-up block (const glide)
  for (let i = 0; i < 16; i++) r.process([], [L, R])
  let l = 0
  let rSum = 0
  for (let i = 0; i < 256; i++) {
    l += L[i]
    rSum += R[i]
  }
  return { l: l / 256, r: rSum / 256 }
}

describe('width effect structure', () => {
  it('registers chan-scoped refs for width and bypass', () => {
    const { refs } = compileFx(DEFAULT_WIDTH, 1, 1)
    expect(refs.keys.has('chan:chan_1:chef_x:width')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:bypass')).toBe(true)
  })

  it('mid/side + one Haas delay line, no other stateful nodes', () => {
    const { out } = compileFx(DEFAULT_WIDTH, 1, 1)
    const kinds = new Set<string>()
    walkAll(out.left, (n) => kinds.add(n.kind as string))
    walkAll(out.right, (n) => kinds.add(n.kind as string))
    expect(kinds.has('delay')).toBe(true)
    for (const stateful of ['convolve', 'z', 'phasor']) {
      expect(kinds.has(stateful)).toBe(false)
    }
  })
})

describe('width effect rendering', () => {
  it('mono input (L=R=1) stays 1/1 at width ≤ 1', async () => {
    for (const width of [0, 1]) {
      const { out } = compileFx({ ...DEFAULT_WIDTH, width }, 1, 1)
      const { l, r } = await renderSettled(out)
      expect(l).toBeCloseTo(1, 1)
      expect(r).toBeCloseTo(1, 1)
    }
  })

  it('width 1 is passthrough', async () => {
    const { out } = compileFx(DEFAULT_WIDTH, 1, 0)
    const { l, r } = await renderSettled(out)
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0, 2)
  })

  it('width 0 collapses to mono (outL = outR = mean)', async () => {
    const { out } = compileFx({ ...DEFAULT_WIDTH, width: 0 }, 1, 0)
    const { l, r } = await renderSettled(out)
    expect(l).toBeCloseTo(0.5, 1)
    expect(r).toBeCloseTo(0.5, 1)
  })

  it('width 2 spreads a mono source (L≠R, mono sum preserved)', async () => {
    const { out } = compileFx({ ...DEFAULT_WIDTH, width: 2 }, 1, 1)
    const { l, r } = await renderSettled(out)
    // Haas pair: mid ± delayed mid. At DC the delayed copy is also 1.
    expect(l).toBeCloseTo(2, 1)
    expect(r).toBeCloseTo(0, 2)
    expect(l + r).toBeCloseTo(2, 1)
  })

  it('width 2 doubles the real side plus the pseudo side (L=1, R=0 → 2 / −1)', async () => {
    const { out } = compileFx({ ...DEFAULT_WIDTH, width: 2 }, 1, 0)
    const { l, r } = await renderSettled(out)
    expect(l).toBeCloseTo(2, 1)
    expect(r).toBeCloseTo(-1, 1)
    expect(l + r).toBeCloseTo(1, 1)
  })

  it('bypass passes both channels through', async () => {
    const { out } = compileFx({ ...DEFAULT_WIDTH, bypass: 1, width: 2 }, 1, 0)
    const { l, r } = await renderSettled(out)
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0, 2)
  })
})

describe('width as a modular stereo module', () => {
  /** gate(1) → gain(level) → width.in / width.inR → output.inL / output.inR. */
  function makeWidthPatch(params: Record<string, number>, leftLevel: number, rightLevel?: number): ModularInstrument {
    const hasR = rightLevel !== undefined
    const modules: ModularInstrument['modules'] = {
      gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
      gL: { id: 'gL', type: 'gain', params: { level: leftLevel }, pos: { x: 0, y: 0 } },
      wd: { id: 'wd', type: 'width', params, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    }
    const connections: ModularInstrument['connections'] = {
      c1: { id: 'c1', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'gL', port: 'in' }, gain: 1 },
      c3: { id: 'c3', from: { moduleId: 'gL', port: 'out' }, to: { moduleId: 'wd', port: 'in' }, gain: 1 },
      c5: { id: 'c5', from: { moduleId: 'wd', port: 'outL' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
      c6: { id: 'c6', from: { moduleId: 'wd', port: 'outR' }, to: { moduleId: 'out', port: 'inR' }, gain: 1 },
    }
    if (hasR) {
      modules.gR = { id: 'gR', type: 'gain', params: { level: rightLevel }, pos: { x: 0, y: 0 } }
      connections.c2 = { id: 'c2', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'gR', port: 'in' }, gain: 1 }
      connections.c4 = { id: 'c4', from: { moduleId: 'gR', port: 'out' }, to: { moduleId: 'wd', port: 'inR' }, gain: 1 }
    }
    return {
      id: 'i1', kind: 'modular', name: 'Test',
      modules, connections, outputId: 'out',
      effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
      channelId: MASTER_CHANNEL_ID,
      pan: 0,
    }
  }

  const compilePatch = (inst: ModularInstrument, paramRefs?: ReturnType<typeof mockParamRefs>) =>
    compileModular(
      inst, el.const({ value: 440 }), el.const({ value: 1 }), 'voice',
      [], 1, {}, undefined, paramRefs as never,
    )

  const renderPatch = async (inst: ModularInstrument) => {
    const { left, right } = compilePatch(inst)
    return renderSettled({ left, right })
  }

  it('registers a live width ref scoped to the module', () => {
    const refs = mockParamRefs()
    compilePatch(makeWidthPatch(DEFAULT_WIDTH, 1, 0), refs)
    expect(refs.keys.has('i1:wd:width')).toBe(true)
  })

  it('processes the stereo pair: width 2 turns L=1/R=0 into 2/−1', async () => {
    const { l, r } = await renderPatch(makeWidthPatch({ ...DEFAULT_WIDTH, width: 2 }, 1, 0))
    // mid 0.5 + 2×sideReal 0.5 + spread×pseudo (0.5 at DC) = 2.0 / −1.0.
    expect(l).toBeCloseTo(2, 1)
    expect(r).toBeCloseTo(-1, 1)
    expect(l + r).toBeCloseTo(1, 1)
  })

  it('width 1 is passthrough', async () => {
    const { l, r } = await renderPatch(makeWidthPatch(DEFAULT_WIDTH, 1, 0))
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0, 2)
  })

  it('width 0 collapses to mono', async () => {
    const { l, r } = await renderPatch(makeWidthPatch({ ...DEFAULT_WIDTH, width: 0 }, 1, 0))
    expect(l).toBeCloseTo(0.5, 1)
    expect(r).toBeCloseTo(0.5, 1)
  })

  it('bypass passes both channels through', async () => {
    const { l, r } = await renderPatch(makeWidthPatch({ ...DEFAULT_WIDTH, bypass: 1, width: 2 }, 1, 0))
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0, 2)
  })

  it('without inR, the mono input is duplicated at width ≤ 1', async () => {
    const { l, r } = await renderPatch(makeWidthPatch(DEFAULT_WIDTH, 1))
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(1, 1)
  })

  it('without inR, width 2 spreads the mono input (L≠R, sum preserved)', async () => {
    const { l, r } = await renderPatch(makeWidthPatch({ ...DEFAULT_WIDTH, width: 2 }, 1))
    expect(Math.abs(l - r)).toBeGreaterThan(0.5)
    expect(l + r).toBeCloseTo(2, 1)
  })
})
