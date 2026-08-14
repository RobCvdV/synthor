import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileModular } from './modular'
import { compileChannelEffects } from './mixer'
import type { SampleMeta } from './instruments'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ChannelEffect, type ModularInstrument } from '../domain/types'

const META: SampleMeta = { hash: 'irhash', channels: 1, sampleRate: 44100, frames: 2048 }
const META_2: SampleMeta = { hash: 'irhash2', channels: 1, sampleRate: 44100, frames: 2048 }

const DEFAULT_CONV: Record<string, number> = { bypass: 0, sampleIndex: 0, mix: 1, gain: 1 }

/** A minimal patch: gate → gain(1) → conv.in → output.inL. */
function makeConvPatch(params: Record<string, number>): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
      g1: { id: 'g1', type: 'gain', params: { level: 1 }, pos: { x: 0, y: 0 } },
      cv: { id: 'cv', type: 'conv', params, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'g1', port: 'in' }, gain: 1 },
      c2: { id: 'c2', from: { moduleId: 'g1', port: 'out' }, to: { moduleId: 'cv', port: 'in' }, gain: 1 },
      c3: { id: 'c3', from: { moduleId: 'cv', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
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

const compile = (inst: ModularInstrument, meta: SampleMeta[], paramRefs?: ReturnType<typeof mockParamRefs>) =>
  compileModular(
    inst, el.const({ value: 440 }), el.const({ value: 1 }), 'voice',
    meta, 1, {}, undefined, paramRefs as never,
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

function collect(n: unknown): Array<{ kind: string; props: Record<string, unknown> }> {
  const found: Array<{ kind: string; props: Record<string, unknown> }> = []
  walkAll(n, (node) => found.push({ kind: node.kind as string, props: (node.props ?? {}) as Record<string, unknown> }))
  return found
}

/** Render offline with a VFS, return the mean of the last settled block. */
async function renderSettled(
  pair: { left: NodeRepr_t; right: NodeRepr_t },
  vfs: Record<string, Float32Array>,
): Promise<{ l: number; r: number }> {
  const r = new OfflineRenderer()
  await r.initialize({
    numInputChannels: 0, numOutputChannels: 2, blockSize: 512, sampleRate: 44100,
    virtualFileSystem: vfs,
  })
  await r.render(pair.left, pair.right)
  const L = new Float32Array(512)
  const R = new Float32Array(512)
  r.process([], [L, R]) // warm-up block (const glide)
  for (let i = 0; i < 40; i++) r.process([], [L, R]) // settle past convolver latency
  let l = 0
  let rSum = 0
  for (let i = 0; i < 512; i++) {
    l += L[i]
    rSum += R[i]
  }
  return { l: l / 512, r: rSum / 512 }
}

/** A constant-DC render of the modular conv patch with the given IR. */
function renderPatch(meta: SampleMeta[], ir: Float32Array, params = DEFAULT_CONV) {
  const { left, right } = compile(makeConvPatch(params), meta)
  return renderSettled({ left, right }, { [meta[0]?.hash ?? 'irhash']: ir })
}

describe('conv module structure', () => {
  it('convolves with the sample at sampleIndex via its VFS hash', () => {
    const { left } = compile(makeConvPatch(DEFAULT_CONV), [META])
    const nodes = collect(left)
    const conv = nodes.find((n) => n.kind === 'convolve')
    expect(conv).toBeDefined()
    expect(conv!.props.path).toBe('irhash')
  })

  it('switching sampleIndex swaps the IR path', () => {
    const { left } = compile(makeConvPatch({ ...DEFAULT_CONV, sampleIndex: 1 }), [META, META_2])
    expect(collect(left).find((n) => n.kind === 'convolve')?.props.path).toBe('irhash2')
  })

  it('registers live refs for mix and gain', () => {
    const refs = mockParamRefs()
    compile(makeConvPatch(DEFAULT_CONV), [META], refs)
    expect(refs.keys.has('i1:cv:mix')).toBe(true)
    expect(refs.keys.has('i1:cv:gain')).toBe(true)
  })

  it('falls back to dry passthrough without a sample', () => {
    const { left } = compile(makeConvPatch(DEFAULT_CONV), [])
    expect(collect(left).some((n) => n.kind === 'convolve')).toBe(false)
  })

  it('bypass skips the convolve node entirely', () => {
    const { left } = compile(makeConvPatch({ ...DEFAULT_CONV, bypass: 1 }), [META])
    expect(collect(left).some((n) => n.kind === 'convolve')).toBe(false)
  })
})

describe('conv module rendering', () => {
  const impulse = (() => {
    const data = new Float32Array(2048)
    data[0] = 1
    return data
  })()
  const halfHalf = (() => {
    const data = new Float32Array(2048)
    data[0] = 0.5
    data[1] = 0.5
    return data
  })()
  const cancel = (() => {
    const data = new Float32Array(2048)
    data[0] = 1
    data[1] = -1
    return data
  })()

  it('unit impulse IR passes DC through (out ≈ 1)', async () => {
    const { l } = await renderPatch([META], impulse)
    expect(l).toBeCloseTo(1, 1)
  })

  it('IR summing to 1 has unity DC gain', async () => {
    const { l } = await renderPatch([META], halfHalf)
    expect(l).toBeCloseTo(1, 1)
  })

  it('IR summing to 0 cancels DC (real convolution, not passthrough)', async () => {
    const { l } = await renderPatch([META], cancel)
    expect(Math.abs(l)).toBeLessThan(0.01)
  })

  it('mix 0 is the dry path', async () => {
    const { l } = await renderPatch([META], cancel, { ...DEFAULT_CONV, mix: 0 })
    expect(l).toBeCloseTo(1, 1)
  })

  it('L1 normalization keeps a huge-gain IR at unity (regression)', async () => {
    // An IR of a thousand ones has DC gain 1000 — without normalization the
    // wet signal would come out 1000× louder than the dry input.
    const ones = new Float32Array(2048)
    for (let i = 0; i < 1000; i++) ones[i] = 1
    const { l } = await renderPatch([{ ...META, l1: 1000 }], ones)
    expect(l).toBeCloseTo(1, 1)
  })

  it('gain param scales the normalized wet signal', async () => {
    const ones = new Float32Array(2048)
    for (let i = 0; i < 1000; i++) ones[i] = 1
    const { l } = await renderPatch([{ ...META, l1: 1000 }], ones, { ...DEFAULT_CONV, gain: 2 })
    expect(l).toBeCloseTo(2, 1)
  })

  it('missing IR passes the input through dry', async () => {
    const { left, right } = compile(makeConvPatch(DEFAULT_CONV), [])
    const { l } = await renderSettled({ left, right }, {})
    expect(l).toBeCloseTo(1, 1)
  })
})

describe('conv as a mixer channel effect', () => {
  const fx = (params: Record<string, number>, side?: 'L' | 'R'): ChannelEffect =>
    ({ id: 'chef_x', type: 'conv', params, ...(side ? { side } : {}) })
  const compileFx = (params: Record<string, number>, meta: SampleMeta[], refs = mockParamRefs(), side?: 'L' | 'R') => {
    const out = compileChannelEffects(
      [fx(params, side)],
      { left: el.const({ value: 1 }), right: el.const({ value: 0.25 }) },
      'chan_1',
      refs as never,
      8,
      meta,
    )
    return { out, refs }
  }

  it('registers chan-scoped refs and a convolve with the IR hash', () => {
    const { out, refs } = compileFx(DEFAULT_CONV, [META])
    expect(refs.keys.has('chan:chan_1:chef_x:mix')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:gain')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:bypass')).toBe(true)
    expect(collect(out.left).some((n) => n.kind === 'convolve' && n.props.path === 'irhash')).toBe(true)
  })

  it('missing IR → no convolve, dry passthrough', async () => {
    const { out } = compileFx(DEFAULT_CONV, [])
    expect(collect(out.left).some((n) => n.kind === 'convolve')).toBe(false)
    const { l, r } = await renderSettled(out, {})
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0.25, 1)
  })

  it('side L processes only the left channel; right passes through', async () => {
    const impulse = new Float32Array(2048)
    impulse[0] = 1
    const { out } = compileFx(DEFAULT_CONV, [META], mockParamRefs(), 'L')
    const { l, r } = await renderSettled(out, { irhash: impulse })
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0.25, 1)
  })

  it('bypass passes both channels through', async () => {
    const cancel = new Float32Array(2048)
    cancel[0] = 1
    cancel[1] = -1
    const { out } = compileFx({ ...DEFAULT_CONV, bypass: 1 }, [META])
    const { l, r } = await renderSettled(out, { irhash: cancel })
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0.25, 1)
  })
})

describe('stereo conv (no side) with width', () => {
  const impulse = (() => {
    const data = new Float32Array(2048)
    data[0] = 1
    return data
  })()

  const compileFx = (params: Record<string, number>, meta: SampleMeta[]) => {
    const out = compileChannelEffects(
      [{ id: 'chef_x', type: 'conv', params }],
      { left: el.const({ value: 1 }), right: el.const({ value: 0 }) },
      'chan_1',
      mockParamRefs() as never,
      8,
      meta,
    )
    return out
  }

  it('registers a live width ref', () => {
    const refs = mockParamRefs()
    compileChannelEffects(
      [{ id: 'chef_x', type: 'conv', params: DEFAULT_CONV }],
      { left: el.const({ value: 1 }), right: el.const({ value: 0 }) },
      'chan_1',
      refs as never,
      8,
      [META],
    )
    expect(refs.keys.has('chan:chan_1:chef_x:width')).toBe(true)
  })

  it('width 1 keeps the stereo wet pair (L=1/R=0 → 1/0)', async () => {
    const out = compileFx({ ...DEFAULT_CONV, width: 1 }, [META])
    const { l, r } = await renderSettled(out, { irhash: impulse })
    expect(l).toBeCloseTo(1, 1)
    expect(r).toBeCloseTo(0, 2)
  })

  it('width 0 collapses the wet to mono (0.5/0.5)', async () => {
    const out = compileFx({ ...DEFAULT_CONV, width: 0 }, [META])
    const { l, r } = await renderSettled(out, { irhash: impulse })
    expect(l).toBeCloseTo(0.5, 1)
    expect(r).toBeCloseTo(0.5, 1)
  })

  it('width 2 spreads a mono input via Haas (L=R=1 → 2/0, sum preserved)', async () => {
    const wide = compileChannelEffects(
      [{ id: 'chef_x', type: 'conv', params: { ...DEFAULT_CONV, width: 2 } }],
      { left: el.const({ value: 1 }), right: el.const({ value: 1 }) },
      'chan_1',
      mockParamRefs() as never,
      8,
      [META],
    )
    const w = await renderSettled(wide, { irhash: impulse })
    expect(w.l).toBeCloseTo(2, 1)
    expect(w.r).toBeCloseTo(0, 2)
    expect(w.l + w.r).toBeCloseTo(2, 1)
  })
})
