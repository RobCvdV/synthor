import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { compileModular } from './modular'
import { LFO_WAVEFORMS } from '../domain/moduleDefs'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** gate → lfo.gate, lfo → output. */
function lfoPatch(params: Record<string, number>): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      gate: { id: 'gate', type: 'gate', params: {}, pos: { x: 0, y: 0 } },
      lfo: { id: 'lfo', type: 'lfo', params, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'gate', port: 'out' }, to: { moduleId: 'lfo', port: 'gate' }, gain: 1 },
      c2: { id: 'c2', from: { moduleId: 'lfo', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
    },
    outputId: 'out',
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
  }
}

const compile = (params: Record<string, number>) =>
  compileModular(lfoPatch(params), el.const({ value: 220 }), el.const({ value: 1 }), 'voice').left

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

async function render(params: Record<string, number>, blocks = 40): Promise<Float32Array> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 1, blockSize: 512, sampleRate: 44100 })
  await r.render(compile(params))
  const out = new Float32Array(blocks * 512)
  const buf = new Float32Array(512)
  for (let b = 0; b < blocks; b++) {
    r.process([], [buf])
    out.set(buf, b * 512)
  }
  return out.subarray(2048)
}

describe('lfo module', () => {
  it('builds one phase source and one shape, without selects', () => {
    for (let waveform = 0; waveform < LFO_WAVEFORMS.length; waveform++) {
      const free = kinds(compile({ waveform, sync: 0 }))
      expect(free).toContain('phasor')
      expect(free).not.toContain('sphasor')
      expect(free).not.toContain('select')
      expect(kinds(compile({ waveform, sync: 1 }))).toContain('sphasor')
      expect(kinds(compile({ waveform, sync: 1 }))).not.toContain('phasor')
    }
    expect(kinds(compile({ waveform: 0 }))).toContain('sin')
    expect(kinds(compile({ waveform: 1 }))).not.toContain('sin')
  })

  it.each(LFO_WAVEFORMS.map((name, i) => [name, i] as const))('%s swings between −1 and 1', async (_name, waveform) => {
    const out = await render({ waveform, rate: 10 })
    expect(Math.max(...out)).toBeGreaterThan(0.9)
    expect(Math.min(...out)).toBeLessThan(-0.9)
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThanOrEqual(1.0001)
  })

  it('pulse width sets the duty cycle; square stays at half', async () => {
    const high = (x: Float32Array) => x.filter((v) => v > 0).length / x.length
    expect(high(await render({ waveform: 4, pulseWidth: 0.25, rate: 10 }))).toBeCloseTo(0.25, 1)
    expect(high(await render({ waveform: 3, pulseWidth: 0.25, rate: 10 }))).toBeCloseTo(0.5, 1)
  })
})
