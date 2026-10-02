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
