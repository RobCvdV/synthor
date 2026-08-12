import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileModular, tickTimeSamps } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** A minimal patch: gate → delay.in → output.inL, so the delayed signal is
 *  a step (0 before the first repeat, 1 after). */
function makeDelayPatch(time: number, mix = 1): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
      dl: { id: 'dl', type: 'delay', params: { bypass: 0, time, mix }, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'dl', port: 'in' }, gain: 1 },
      c2: { id: 'c2', from: { moduleId: 'dl', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
    },
    outputId: 'out',
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
  }
}

/** Render a stereo pair offline for `blocks` blocks of 512, return left samples. */
async function renderBlocks(pair: { left: NodeRepr_t; right: NodeRepr_t }, blocks = 16): Promise<Float32Array> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 512, sampleRate: 44100 })
  await r.render(pair.left, pair.right)
  const all = new Float32Array(blocks * 512)
  const L = new Float32Array(512)
  const R = new Float32Array(512)
  for (let b = 0; b < blocks; b++) {
    r.process([], [L, R])
    all.set(L, b * 512)
  }
  return all
}

const compile = (inst: ModularInstrument, rowHz = 8) =>
  compileModular(
    inst, el.const({ value: 440 }), el.const({ value: 1 }), 'voice',
    [], 1, {}, undefined, undefined, undefined, el.const({ value: rowHz }),
  )

/** Visit every Elementary node in a repr tree. N-ary children chain as
 *  `{hd, tl}` wrappers that carry no `children` key, so both shapes are handled. */
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
  // Wrapper object: hd/tl sit directly on it.
  walkAll(node.hd, visit)
  walkAll(node.tl, visit)
}

describe('tempo-synced delay time', () => {
  it('delays by time-in-ticks / rowHz (1 tick at 8 rows/s = 125 ms)', async () => {
    const { left, right } = compile(makeDelayPatch(1))
    const out = await renderBlocks({ left, right })
    // 125 ms = 5512 samples at 44.1 kHz. Before that: silence, after: the gate's 1.
    expect(out[2000]).toBeLessThan(0.1)
    expect(out[7500]).toBeGreaterThan(0.8)
  })

  it('half the row rate doubles the delay (1 tick at 4 rows/s = 250 ms)', async () => {
    const { left, right } = compile(makeDelayPatch(1), 4)
    const out = await renderBlocks({ left, right }, 32)
    // 250 ms = 11025 samples. Still silent at 150 ms, sounding at 350 ms.
    expect(out[6600]).toBeLessThan(0.1)
    expect(out[15000]).toBeGreaterThan(0.8)
  })

  it('fractional ticks: 0.25 tick at 8 rows/s = 31.25 ms', async () => {
    const { left, right } = compile(makeDelayPatch(0.25))
    const out = await renderBlocks({ left, right })
    expect(out[600]).toBeLessThan(0.1)
    expect(out[2500]).toBeGreaterThan(0.8)
  })

  it('tickTimeSamps divides by the live rowHz node (sr in the tree)', () => {
    const node = tickTimeSamps(1, el.const({ value: 8 }))
    const kinds = new Set<string>()
    walkAll(node, (n) => kinds.add(n.kind as string))
    expect(kinds).toContain('div')
    expect(kinds).toContain('sr')
  })

  it('delay node buffer covers the 16-tick maximum', () => {
    const { left } = compile(makeDelayPatch(16))
    let size: unknown
    walkAll(left, (n) => {
      if (n.kind === 'delay' && size === undefined) size = (n.props as Record<string, unknown> | undefined)?.size
    })
    // 16 ticks at 20 BPM (4 rows/beat) at 48 kHz = 576000 samples.
    expect(size).toBe(576000)
  })
})
