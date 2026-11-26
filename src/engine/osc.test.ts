import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { compileModular } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** note → osc.freq, a fast LFO (×scale) → osc.fm, osc → output. */
function fmPatch(waveform: number, amountScale: number): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      note: { id: 'note', type: 'note', params: {}, pos: { x: 0, y: 0 } },
      lfo: { id: 'lfo', type: 'lfo', params: { rate: 30, amountScale }, pos: { x: 0, y: 0 } },
      osc: { id: 'osc', type: 'osc', params: { waveform }, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'note', port: 'freq' }, to: { moduleId: 'osc', port: 'freq' }, gain: 1 },
      c2: { id: 'c2', from: { moduleId: 'lfo', port: 'out' }, to: { moduleId: 'osc', port: 'fm' }, gain: 1 },
      c3: { id: 'c3', from: { moduleId: 'osc', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
    },
    outputId: 'out',
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
  }
}

async function render(inst: ModularInstrument): Promise<Float32Array> {
  const { left, right } = compileModular(inst, el.const({ value: 220 }), el.const({ value: 1 }), 'voice')
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 512, sampleRate: 44100 })
  await r.render(left, right)
  const all = new Float32Array(40 * 512)
  const L = new Float32Array(512)
  const R = new Float32Array(512)
  for (let b = 0; b < 40; b++) {
    r.process([], [L, R])
    all.set(L, b * 512)
  }
  return all
}

describe('osc FM', () => {
  // Saw, square and triangle are blep oscillators; FM taking them below 0 Hz used to blow up.
  it.each([0, 1, 2, 3])('stays bounded when FM sweeps below 0 Hz (waveform %i)', async (waveform) => {
    const out = await render(fmPatch(waveform, 5))
    expect(out.every(Number.isFinite)).toBe(true)
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThan(2.5)
    expect(Math.max(...Array.from(out, Math.abs))).toBeGreaterThan(0.3)
  })
})

/** note → osc → output, no FM. */
function plainPatch(params: Record<string, number>): ModularInstrument {
  const inst = fmPatch(0, 0)
  const { lfo: _lfo, ...modules } = inst.modules
  const { c2: _c2, ...connections } = inst.connections
  return { ...inst, modules: { ...modules, osc: { ...modules.osc, params } }, connections }
}

/** Node kinds in a repr tree (children are arrays or hd/tl cons lists). */
function kinds(n: unknown, out: string[] = []): string[] {
  if (!n || typeof n !== 'object') return out
  const node = n as Record<string, unknown>
  if (node.symbol === '__ELEM_NODE__') out.push(node.kind as string)
  const children = node.children
  if (Array.isArray(children)) for (const c of children) kinds(c, out)
  else if (children && children !== 0) {
    kinds((children as Record<string, unknown>).hd, out)
    kinds((children as Record<string, unknown>).tl, out)
  } else {
    kinds(node.hd, out)
    kinds(node.tl, out)
  }
  return out
}

function zeroCrossingHz(samples: Float32Array, sampleRate = 44100, skip = 2000): number {
  let ups = 0
  for (let i = skip + 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) ups++
  return ups / ((samples.length - skip - 1) / sampleRate)
}

describe('osc graph', () => {
  const generators = ['blepsaw', 'blepsquare', 'bleptriangle', 'sin', 'phasor']
  it.each([
    [0, ['blepsaw']],
    [1, ['phasor']],
    [2, ['bleptriangle']],
    [3, ['sin', 'phasor']],
    [4, ['phasor']],
  ])('builds only the selected waveform (%i)', (waveform, expected) => {
    const { left } = compileModular(plainPatch({ waveform }), el.const({ value: 220 }), el.const({ value: 1 }), 'voice')
    const used = kinds(left).filter((k) => generators.includes(k))
    expect([...new Set(used)].sort()).toEqual([...expected].sort())
    expect(kinds(left)).not.toContain('select')
  })

  it('dc-blocks only triangle and the pulse shapes', () => {
    // dcblock = pole(0.995, zero(...)): look for the pole.
    const poles = (waveform: number) => kinds(compileModular(plainPatch({ waveform }), el.const({ value: 220 }), el.const({ value: 1 }), 'v').left).includes('pole')
    expect([0, 1, 2, 3, 4].map(poles)).toEqual([false, true, true, false, true])
  })

  it('compiles detune and finetune into the pitch', async () => {
    const hz = zeroCrossingHz(await render(plainPatch({ waveform: 3, detune: 12, finetune: -100 })))
    // 220 Hz, +12 st −100 ct = 440 · 2^(−1/12) ≈ 415 Hz.
    expect(hz).toBeGreaterThan(408)
    expect(hz).toBeLessThan(422)
  })

  it.each([0, 1, 2, 3, 4])('waveform %i sounds at full scale', async (waveform) => {
    const out = await render(plainPatch({ waveform }))
    const peak = Math.max(...Array.from(out.subarray(4000), Math.abs))
    expect(peak).toBeGreaterThan(0.7)
    expect(peak).toBeLessThan(1.3)
  })
})
