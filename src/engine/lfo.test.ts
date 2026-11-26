import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { compileModular } from './modular'
import { LFO_WAVEFORMS } from '../domain/moduleDefs'
import { WAVETABLE_SHAPES } from './wavetableShapes'
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

function nodesOf(n: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!n || typeof n !== 'object') return out
  const node = n as Record<string, unknown>
  if (node.symbol === '__ELEM_NODE__') out.push(node)
  const children = node.children
  if (Array.isArray(children)) for (const c of children) nodesOf(c, out)
  else if (children && children !== 0) {
    nodesOf((children as Record<string, unknown>).hd, out)
    nodesOf((children as Record<string, unknown>).tl, out)
  } else {
    nodesOf(node.hd, out)
    nodesOf(node.tl, out)
  }
  return out
}

describe('lfo module', () => {
  it('plays every shape but pulse as the unfiltered wavetable shape of the same name', () => {
    LFO_WAVEFORMS.forEach((name, waveform) => {
      const nodes = nodesOf(compile({ waveform }))
      const wt = nodes.find((n) => n.kind === 'wtosc')
      expect(nodes.some((n) => n.kind === 'select')).toBe(false)
      if (name === 'pulse') {
        expect(wt).toBeUndefined()
        expect(nodes.some((n) => n.kind === 'phasor')).toBe(true)
      } else {
        expect(wt?.props).toEqual({ shape: WAVETABLE_SHAPES.indexOf(name as never), bandlimit: false })
      }
    })
  })

  it('feeds the gate to the reset input only in gate sync', () => {
    const inputs = (sync: number) => {
      let list: unknown = nodesOf(compile({ waveform: 0, sync })).find((n) => n.kind === 'wtosc')!.children
      if (Array.isArray(list)) return list.length
      let count = 0
      while (list && list !== 0) { count++; list = (list as { tl: unknown }).tl }
      return count
    }
    expect(inputs(0)).toBe(1)
    expect(inputs(1)).toBe(3)
    expect(nodesOf(compile({ waveform: 4, sync: 1 })).some((n) => n.kind === 'sphasor')).toBe(true)
  })

  it.each(LFO_WAVEFORMS.map((name, i) => [name, i] as const))('%s peaks at full scale', async (_name, waveform) => {
    const out = await render({ waveform, rate: 10 })
    const peak = Math.max(...Array.from(out, Math.abs))
    expect(peak).toBeGreaterThan(0.95)
    expect(peak).toBeLessThanOrEqual(1.0001)
  })

  it('keeps square edges clean: no band-limited ringing', async () => {
    const out = await render({ waveform: 3, rate: 2 })
    // Away from the two edges per cycle every sample sits exactly at ±1:
    // about one in-between sample per edge, against hundreds of ringing ones band-limited.
    const off = out.filter((v) => Math.abs(Math.abs(v) - 1) > 1e-3).length
    expect(off).toBeLessThan(20)
  })

  it('pulse width sets the duty cycle; square stays at half', async () => {
    const high = (x: Float32Array) => x.filter((v) => v > 0).length / x.length
    expect(high(await render({ waveform: 4, pulseWidth: 0.25, rate: 10 }))).toBeCloseTo(0.25, 1)
    expect(high(await render({ waveform: 3, pulseWidth: 0.25, rate: 10 }))).toBeCloseTo(0.5, 1)
  })

  it('gate sync restarts the cycle on each note-on', async () => {
    // A 3 Hz sine LFO, gated by a 4 Hz on/off train: every note-on starts it at sin(0), rising.
    const r = new OfflineRenderer()
    await r.initialize({ numInputChannels: 0, numOutputChannels: 1, blockSize: 512, sampleRate: 44100 })
    const gate = el.train(4)
    await r.render(compileModular(lfoPatch({ waveform: 0, rate: 3, sync: 1 }), el.const({ value: 220 }), gate, 'voice').left)
    const out = new Float32Array(100 * 512)
    const buf = new Float32Array(512)
    for (let b = 0; b < 100; b++) { r.process([], [buf]); out.set(buf, b * 512) }
    const period = 44100 / 4
    for (let k = 1; k < 4; k++) {
      const on = Math.round(k * period)
      expect(Math.abs(out[on])).toBeLessThan(0.01)
      expect(out[on + 400]).toBeCloseTo(Math.sin((2 * Math.PI * 3 * 400) / 44100), 2)
    }
  })
})
