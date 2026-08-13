import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileModular } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** A minimal patch: noise → output.inL. The noise module has no inlets. */
function makeNoisePatch(params: Record<string, number>): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      nz: { id: 'nz', type: 'noise', params, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'nz', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
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

/** Render a stereo pair offline for `blocks` blocks, return left samples. */
async function renderBlocks(pair: { left: NodeRepr_t; right: NodeRepr_t }, blocks = 4): Promise<Float32Array> {
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

describe('noise module', () => {
  it('builds white and pink branches in parallel with voice-scoped keys', () => {
    const refs = mockParamRefs()
    const { left } = compile(makeNoisePatch({ mode: 0, level: 1 }), refs)
    const rands: string[] = []
    walkAll(left, (n) => {
      if (n.kind === 'rand') rands.push(((n.props as Record<string, unknown> | undefined)?.key as string) ?? '')
    })
    // Unkeyed rands hash identically per voice and would share one RNG stream.
    // (Shared subtrees are visited more than once — compare the key set.)
    expect(new Set(rands)).toEqual(new Set(['voice:nz:noise', 'voice:nz:pink']))
  })

  it('the pink branch runs its 3-pole shaping filter', () => {
    const { left } = compile(makeNoisePatch({ mode: 1, level: 1 }))
    const kinds = new Set<string>()
    walkAll(left, (n) => kinds.add(n.kind as string))
    expect(kinds).toContain('pole')
  })

  it('registers live refs for mode and level', () => {
    const refs = mockParamRefs()
    compile(makeNoisePatch({ mode: 0, level: 1 }), refs)
    expect(refs.keys.has('i1:nz:mode')).toBe(true)
    expect(refs.keys.has('i1:nz:level')).toBe(true)
  })

  it('renders silence at level 0', async () => {
    const { left, right } = compile(makeNoisePatch({ mode: 0, level: 0 }))
    const out = await renderBlocks({ left, right })
    for (const x of out) expect(x).toBe(0)
  })

  it('renders non-silent, finite output at full level', async () => {
    const { left, right } = compile(makeNoisePatch({ mode: 0, level: 1 }))
    const out = await renderBlocks({ left, right })
    let max = 0
    for (const x of out) {
      expect(Number.isFinite(x)).toBe(true)
      max = Math.max(max, Math.abs(x))
    }
    expect(max).toBeGreaterThan(0.1)
  })
})
