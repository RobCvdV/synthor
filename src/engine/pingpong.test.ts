import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileChannelEffects } from './mixer'
import { compileModular } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ChannelEffect, type ModularInstrument } from '../domain/types'

/** rowHz = 44.1 → 1 tick = exactly 1000 samples at 44.1 kHz. */
const ROW_HZ = 44.1
const T = 1000

const DEFAULT_DELAYS: Record<string, number> = { bypass: 0, time: 1, mix: 1, pingpong: 0 }
const DEFAULT_ECHOS: Record<string, number> = { bypass: 0, time: 1, feedback: 0.5, mix: 1, pingpong: 0 }

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

const fx = (type: 'delayS' | 'echoS', params: Record<string, number>): ChannelEffect =>
  ({ id: 'chef_x', type, params })

const compileFx = (type: 'delayS' | 'echoS', params: Record<string, number>, refs = mockParamRefs()) => {
  const out = compileChannelEffects(
    [fx(type, params)],
    { left: el.in({ channel: 0 }), right: el.in({ channel: 1 }) },
    'chan_1',
    refs as never,
    ROW_HZ,
  )
  return { out, refs }
}

/** Render with an impulse on the chosen input channel(s); return both output buffers. */
async function renderImpulse(
  out: { left: NodeRepr_t; right: NodeRepr_t },
  impulse: { L?: boolean; R?: boolean },
  blocks = 60,
): Promise<{ L: Float32Array; R: Float32Array }> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 2, numOutputChannels: 2, blockSize: 128, sampleRate: 44100 })
  await r.render(out.left, out.right)
  const inL = new Float32Array(128)
  const inR = new Float32Array(128)
  const allL = new Float32Array(blocks * 128)
  const allR = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    if (b === 0) {
      if (impulse.L) inL[0] = 1
      if (impulse.R) inR[0] = 1
    }
    const outL = new Float32Array(128)
    const outR = new Float32Array(128)
    r.process([inL, inR], [outL, outR])
    allL.set(outL, b * 128)
    allR.set(outR, b * 128)
    inL[0] = 0
    inR[0] = 0
  }
  return { L: allL, R: allR }
}

/** Peak |amplitude| in a small window around a sample position. */
function peakIn(sig: Float32Array, center: number, half = 10): number {
  let m = 0
  for (let i = Math.max(0, center - half); i < Math.min(sig.length, center + half); i++) {
    m = Math.max(m, Math.abs(sig[i]))
  }
  return m
}

describe('stereo delay (delayS) as a channel effect', () => {
  it('registers chan-scoped refs for mix and pingpong', () => {
    const { refs } = compileFx('delayS', DEFAULT_DELAYS)
    expect(refs.keys.has('chan:chan_1:chef_x:mix')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:pingpong')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:bypass')).toBe(true)
  })

  it('time is a live ref (slider retunes without a recompile)', () => {
    const { refs } = compileFx('delayS', DEFAULT_DELAYS)
    expect(refs.keys.has('chan:chan_1:chef_x:time')).toBe(true)
  })

  it('pp=0: the left impulse echoes on the left channel only', async () => {
    const { out } = compileFx('delayS', DEFAULT_DELAYS)
    const { L, R } = await renderImpulse(out, { L: true })
    expect(peakIn(L, T)).toBeGreaterThan(0.9)
    expect(peakIn(R, T)).toBeLessThan(0.01)
  })

  it('pp=1: the left impulse echoes on the right channel only', async () => {
    const { out } = compileFx('delayS', { ...DEFAULT_DELAYS, pingpong: 1 })
    const { L, R } = await renderImpulse(out, { L: true })
    expect(peakIn(L, T)).toBeLessThan(0.01)
    expect(peakIn(R, T)).toBeGreaterThan(0.9)
  })

  it('mix=0 passes only the dry impulse through', async () => {
    const { out } = compileFx('delayS', { ...DEFAULT_DELAYS, mix: 0 })
    const { L, R } = await renderImpulse(out, { L: true })
    expect(peakIn(L, T)).toBeLessThan(0.01)
    expect(peakIn(R, T)).toBeLessThan(0.01)
  })
})

describe('stereo echo (echoS) as a channel effect', () => {
  it('registers chan-scoped refs for feedback, mix and pingpong', () => {
    const { refs } = compileFx('echoS', DEFAULT_ECHOS)
    expect(refs.keys.has('chan:chan_1:chef_x:feedback')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:mix')).toBe(true)
    expect(refs.keys.has('chan:chan_1:chef_x:pingpong')).toBe(true)
  })

  it('time is a live ref (slider retunes without a recompile)', () => {
    const { refs } = compileFx('echoS', DEFAULT_ECHOS)
    expect(refs.keys.has('chan:chan_1:chef_x:time')).toBe(true)
  })

  it('pp=0: repeats stay on the left with fb decay 1, 0.5, 0.25', async () => {
    const { out } = compileFx('echoS', DEFAULT_ECHOS)
    const { L, R } = await renderImpulse(out, { L: true })
    expect(peakIn(L, T)).toBeCloseTo(1, 1)
    expect(peakIn(L, 2 * T)).toBeCloseTo(0.5, 1)
    expect(peakIn(L, 3 * T)).toBeCloseTo(0.25, 1)
    expect(peakIn(R, T)).toBeLessThan(0.01)
    expect(peakIn(R, 2 * T)).toBeLessThan(0.01)
  })

  it('pp=1: repeats bounce L→R→L→R with fb decay', async () => {
    const { out } = compileFx('echoS', { ...DEFAULT_ECHOS, pingpong: 1 })
    const { L, R } = await renderImpulse(out, { L: true })
    // First bounce crosses at T, then alternates every T: 1, 1, fb, fb².
    expect(peakIn(R, T)).toBeCloseTo(1, 1)
    expect(peakIn(L, 2 * T)).toBeCloseTo(1, 1)
    expect(peakIn(R, 3 * T)).toBeCloseTo(0.5, 1)
    expect(peakIn(L, 4 * T)).toBeCloseTo(0.25, 1)
    expect(peakIn(L, T)).toBeLessThan(0.01)
  })
})

describe('stereo delay/echo as modular modules', () => {
  function makePatch(type: 'delayS' | 'echoS', params: Record<string, number>): ModularInstrument {
    return {
      id: 'i1', kind: 'modular', name: 'Test',
      modules: {
        gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
        g1: { id: 'g1', type: 'gain', params: { level: 1 }, pos: { x: 0, y: 0 } },
        ds: { id: 'ds', type, params, pos: { x: 0, y: 0 } },
        out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
      },
      connections: {
        c1: { id: 'c1', from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: 'g1', port: 'in' }, gain: 1 },
        c2: { id: 'c2', from: { moduleId: 'g1', port: 'out' }, to: { moduleId: 'ds', port: 'in' }, gain: 1 },
        c3: { id: 'c3', from: { moduleId: 'ds', port: 'outL' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
        c4: { id: 'c4', from: { moduleId: 'ds', port: 'outR' }, to: { moduleId: 'out', port: 'inR' }, gain: 1 },
      },
      outputId: 'out',
      effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
      channelId: MASTER_CHANNEL_ID,
      pan: 0,
    }
  }

  it('registers live refs scoped to the module', () => {
    const refs = mockParamRefs()
    compileModular(
      makePatch('echoS', DEFAULT_ECHOS), el.const({ value: 440 }), el.in({ channel: 0 }), 'voice',
      [], 1, {}, undefined, refs as never, undefined, ROW_HZ,
    )
    expect(refs.keys.has('i1:ds:pingpong')).toBe(true)
    expect(refs.keys.has('i1:ds:feedback')).toBe(true)
    expect(refs.keys.has('i1:ds:mix')).toBe(true)
  })

  it('echoS with pp=1 bounces a mono source between L and R', async () => {
    const { left, right } = compileModular(
      makePatch('echoS', { ...DEFAULT_ECHOS, pingpong: 1 }),
      el.const({ value: 440 }), el.in({ channel: 0 }), 'voice',
      [], 1, {}, undefined, undefined, undefined, ROW_HZ,
    )
    // Single input channel for the gate impulse.
    const r = new OfflineRenderer()
    await r.initialize({ numInputChannels: 1, numOutputChannels: 2, blockSize: 128, sampleRate: 44100 })
    await r.render(left, right)
    const blocks = 60
    const allL = new Float32Array(blocks * 128)
    const allR = new Float32Array(blocks * 128)
    for (let b = 0; b < blocks; b++) {
      const inGate = new Float32Array(128)
      if (b === 0) inGate[0] = 1
      const outL = new Float32Array(128)
      const outR = new Float32Array(128)
      r.process([inGate], [outL, outR])
      allL.set(outL, b * 128)
      allR.set(outR, b * 128)
    }
    expect(peakIn(allR, T)).toBeCloseTo(1, 1)
    expect(peakIn(allL, 2 * T)).toBeCloseTo(1, 1)
    expect(peakIn(allL, T)).toBeLessThan(0.01)
  })
})
