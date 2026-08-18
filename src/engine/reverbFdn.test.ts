import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileChannelEffects } from './mixer'
import { compileModular } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ChannelEffect, type ModularInstrument } from '../domain/types'

/** Defaults match the reverb def in moduleDefs.ts (kept for saved patches). */
const REVERB_DEFAULTS = { bypass: 0, roomSize: 0.5, feedback: 0.45, damping: 0.5, stereoWidth: 0.6, mix: 0.35 }

/** A minimal patch: gate → reverb.in → output.inL. */
function makeReverbPatch(params: Record<string, number>): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
      rv: { id: 'rv', type: 'reverb', params: { ...REVERB_DEFAULTS, ...params }, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'rv', port: 'in' }, gain: 1 },
      c2: { id: 'c2', from: { moduleId: 'rv', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
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

/** Render a stereo pair offline for `blocks` blocks of 256; return [L, R]. */
async function renderBlocks(
  pair: { left: NodeRepr_t; right: NodeRepr_t },
  blocks = 16,
): Promise<[Float32Array, Float32Array]> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 256, sampleRate: 44100 })
  await r.render(pair.left, pair.right)
  const allL = new Float32Array(blocks * 256)
  const allR = new Float32Array(blocks * 256)
  const L = new Float32Array(256)
  const R = new Float32Array(256)
  for (let b = 0; b < blocks; b++) {
    r.process([], [L, R])
    allL.set(L, b * 256)
    allR.set(R, b * 256)
  }
  return [allL, allR]
}

const compileMixer = (params: Record<string, number> = {}, refs?: ReturnType<typeof mockParamRefs>) => {
  const fx: ChannelEffect = { id: 'chef_1', type: 'reverb', params: { ...REVERB_DEFAULTS, ...params } }
  return compileChannelEffects(
    [fx],
    { left: el.const({ value: 1 }), right: el.const({ value: 1 }) },
    'chan_1',
    refs as never,
  )
}

const compilePatch = (params: Record<string, number> = {}, refs?: ReturnType<typeof mockParamRefs>) =>
  compileModular(
    makeReverbPatch({ ...REVERB_DEFAULTS, ...params }),
    el.const({ value: 440 }), el.const({ value: 1 }), 'voice',
    [], 1, {}, undefined, refs as never,
  )

/** Collect topology facts across both output channels — walking one side
 *  misses half the FDN (yl/yr reference complementary line sets). */
function collect(pair: { left: NodeRepr_t; right: NodeRepr_t }) {
  const kinds = new Set<string>()
  const delayKeys = new Set<string>()
  const sdelayKeys = new Set<string>()
  const tapInNames = new Set<string>()
  const tapOutNames = new Set<string>()
  const visit = (n: Record<string, unknown>) => {
    kinds.add(n.kind as string)
    const props = (n.props ?? {}) as Record<string, unknown>
    if (n.kind === 'delay' && typeof props.key === 'string') delayKeys.add(props.key)
    if (n.kind === 'sdelay' && typeof props.key === 'string') sdelayKeys.add(props.key)
    if (n.kind === 'tapIn') tapInNames.add(props.name as string)
    if (n.kind === 'tapOut') tapOutNames.add(props.name as string)
  }
  walkAll(pair.left, visit)
  walkAll(pair.right, visit)
  return { kinds, delayKeys, sdelayKeys, tapInNames, tapOutNames }
}

/** 1 for the first 8192 samples (~186 ms @ 44.1 kHz), then 0 — excites the
 *  FDN and lets the tail ring out. accum (not counter) counts without a
 *  rising gate edge. */
function burst(): NodeRepr_t {
  const count = el.accum(el.const({ value: 1 }), el.const({ value: 0 }))
  return el.le(count, el.const({ value: 8192 }))
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / (to - from))
}

/** Max |normalized cross-correlation| of L and R over lags 0..maxLag in [from, to].
 *  A ping-pong echo makes R a delayed copy of L → a strong peak at the
 *  line-spacing lag; decorrelated tails stay near the noise floor (~0.03). */
function maxXCorr(L: Float32Array, R: Float32Array, from: number, to: number, maxLag: number): number {
  let eL = 0, eR = 0
  for (let i = from; i < to; i++) { eL += L[i] * L[i]; eR += R[i] * R[i] }
  const norm = Math.sqrt(eL * eR)
  let max = 0
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0
    for (let i = from; i < to; i++) s += L[i] * R[i + lag]
    max = Math.max(max, Math.abs(s / norm))
  }
  return max
}

describe('FDN reverb (mixer)', () => {
  it('builds the full FDN topology: taps, 16 FDN delays, 24 diffusion delays, chorus', () => {
    const { kinds, delayKeys, sdelayKeys, tapInNames, tapOutNames } = collect(compileMixer())
    // smooth decomposes to `pole`, cycle to `sin`+`phasor` in Elementary.
    for (const k of ['tapIn', 'tapOut', 'sdelay', 'delay', 'pole', 'phasor', 'sin']) {
      expect(kinds.has(k)).toBe(true)
    }
    expect(delayKeys.size).toBe(16) // d4 + r0, 8 lines each
    expect(sdelayKeys.size).toBe(24) // 3 diffusion stages × 8
    expect(tapInNames.size).toBe(16)
    expect(tapOutNames.size).toBe(16)
  })

  it('scopes every delay and tap to channel and effect id', () => {
    const { delayKeys, sdelayKeys, tapInNames, tapOutNames } = collect(compileMixer())
    for (const k of [...delayKeys, ...sdelayKeys, ...tapInNames, ...tapOutNames]) {
      expect(k.startsWith('chan:chan_1:chef_1:')).toBe(true)
    }
    expect(tapInNames.has('chan:chan_1:chef_1:r0:fdn0')).toBe(true)
    expect(tapInNames.has('chan:chan_1:chef_1:d4:fdn7')).toBe(true)
  })

  it('sizes the FDN delay buffers for the longest line (750 ms @ 44.1 kHz)', () => {
    const pair = compileMixer()
    const sizes = new Set<number>()
    walkAll(pair.left, (n) => {
      if (n.kind === 'delay') sizes.add((n.props as Record<string, unknown>).size as number)
    })
    walkAll(pair.right, (n) => {
      if (n.kind === 'delay') sizes.add((n.props as Record<string, unknown>).size as number)
    })
    // 750 ms at 44.1 kHz covers roomSize=1 (544 ms + 2.5 ms chorus).
    expect(sizes).toEqual(new Set([33075]))
  })

  it('sizes diffusion delays to 14 ms × (i+1)/8 per stage', () => {
    const pair = compileMixer()
    const byKey = new Map<string, number>()
    walkAll(pair.left, (n) => {
      if (n.kind === 'sdelay') {
        const props = n.props as Record<string, unknown>
        byKey.set(props.key as string, props.size as number)
      }
    })
    // 14 ms at 44.1 kHz = 617.4 samples; line 0 gets 1/8, line 7 the whole stage.
    expect(byKey.get('chan:chan_1:chef_1:d1:s0')).toBeCloseTo(617.4 / 8, 1)
    expect(byKey.get('chan:chan_1:chef_1:d1:s7')).toBeCloseTo(617.4, 1)
  })

  it('keeps the 5 reverb param refs + bypass (backward-compatible keys)', () => {
    const refs = mockParamRefs()
    compileMixer({}, refs)
    for (const name of ['roomSize', 'feedback', 'damping', 'stereoWidth', 'mix', 'bypass']) {
      expect(refs.keys.has(`chan:chan_1:chef_1:${name}`)).toBe(true)
    }
  })

  it('mix 0 passes the dry signal through unchanged', async () => {
    const pair = compileMixer({ mix: 0 })
    const [L, R] = await renderBlocks(pair, 16)
    // Skip the ~20 ms const glide; the wet branch is NaN-free too (0·NaN = NaN).
    for (let i = 2000; i < L.length; i++) {
      expect(Math.abs(L[i] - 1)).toBeLessThan(0.01)
      expect(Math.abs(R[i] - 1)).toBeLessThan(0.01)
    }
  })

  it('mix 1: a burst excites a dense tail that decays', async () => {
    // Noise burst, not a plain gate: a constant input cancels in the H8
    // upmix/diffusion (its DC response is ~0), so it can't excite the network.
    // Burst is long (~0.74 s) and the render ~2.3 s because the network needs
    // its full RT60-scale charge time before the tail settles into decay.
    const count = el.accum(el.const({ value: 1 }), el.const({ value: 0 }))
    const longBurst = el.le(count, el.const({ value: 32768 }))
    const b = el.mul(longBurst, el.noise({ key: 'test:burst:noise' }))
    const fx: ChannelEffect = { id: 'chef_1', type: 'reverb', params: { ...REVERB_DEFAULTS, mix: 1 } }
    const pair = compileChannelEffects([fx], { left: b, right: b }, 'chan_1')
    const [L, R] = await renderBlocks(pair, 400)
    for (const x of L) expect(Number.isFinite(x)).toBe(true)
    for (const x of R) expect(Number.isFinite(x)).toBe(true)
    // Charged network inside the burst window; last 46 ms is ~1.5 s after
    // the cut — every loop has recirculated many times at 0.45 feedback.
    const burstRms = rms(L, 24000, 32000)
    const tailRms = rms(L, L.length - 2048, L.length)
    expect(burstRms).toBeGreaterThan(0.1)
    expect(tailRms).toBeLessThan(0.5 * burstRms)
  })

  it('spreads a left-only burst across both outputs', async () => {
    const b = burst()
    const fx: ChannelEffect = { id: 'chef_1', type: 'reverb', params: { ...REVERB_DEFAULTS, mix: 1 } }
    const pair = compileChannelEffects([fx], { left: b, right: el.const({ value: 0 }) }, 'chan_1')
    const [, R] = await renderBlocks(pair, 64)
    let maxR = 0
    for (const x of R) {
      expect(Number.isFinite(x)).toBe(true)
      maxR = Math.max(maxR, Math.abs(x))
    }
    expect(maxR).toBeGreaterThan(0.01)
  })

  it('roomSize 1: left and right stay decorrelated (no ping-pong echo)', async () => {
    // Natural width (stereoWidth 1) isolates the network itself from the
    // mid/side width mixing. Without the d4 pre-spread, every r0 line carries
    // a copy of the input and the interleaved downmix echoes it L-R-L-R…
    // Separate noise streams per channel: the dry now passes at full level,
    // so identical inputs would dominate the cross-correlation by themselves.
    const fx: ChannelEffect = { id: 'chef_1', type: 'reverb', params: { ...REVERB_DEFAULTS, roomSize: 1, stereoWidth: 1, mix: 1 } }
    const nl = el.noise({ key: 'test:pingpong:noiseL' })
    const nr = el.noise({ key: 'test:pingpong:noiseR' })
    const pair = compileChannelEffects([fx], { left: nl, right: nr }, 'chan_1')
    const [L, R] = await renderBlocks(pair, 200)
    expect(rms(L, 15000, 40000)).toBeGreaterThan(0.05)
    // …which would peak ≫0.3 at the 48 ms line-spacing lag (≈2117 samples).
    expect(maxXCorr(L, R, 15000, 40000, 8000)).toBeLessThan(0.25)
  })
})

describe('FDN reverb (modular)', () => {
  it('scopes taps to the voice and registers instrument-scoped refs', () => {
    const refs = mockParamRefs()
    const pair = compilePatch({}, refs)
    const { kinds, tapInNames } = collect(pair)
    expect(kinds.has('tapIn')).toBe(true)
    expect(kinds.has('delay')).toBe(true)
    expect(tapInNames.has('voice:rv:r0:fdn0')).toBe(true)
    expect(tapInNames.has('voice:rv:d4:fdn7')).toBe(true)
    for (const name of ['roomSize', 'feedback', 'damping', 'stereoWidth', 'mix']) {
      expect(refs.keys.has(`i1:rv:${name}`)).toBe(true)
    }
  })

  it('bypass short-circuits before building the FDN', () => {
    const refs = mockParamRefs()
    const pair = compilePatch({ bypass: 1 }, refs)
    const { kinds } = collect(pair)
    expect(kinds.has('tapIn')).toBe(false)
    expect(kinds.has('delay')).toBe(false)
    expect(refs.keys.has('i1:rv:roomSize')).toBe(false)
  })

  it('renders the dry signal at mix 0 (wet side NaN-free)', async () => {
    const pair = compilePatch({ mix: 0 })
    const [L] = await renderBlocks(pair, 16)
    for (let i = 2000; i < L.length; i++) {
      expect(Math.abs(L[i] - 1)).toBeLessThan(0.01)
    }
  })
})
