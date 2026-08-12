import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { compileModular } from './modular'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** A minimal patch: one eff inlet feeding the output's left channel. */
function makePatch(effParams: Record<string, number>, effName = 'Eff In 01'): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      eff1: { id: 'eff1', type: 'eff', name: effName, params: effParams, pos: { x: 0, y: 0 } },
      out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
    },
    connections: {
      c1: { id: 'c1', from: { moduleId: 'eff1', port: 'val' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
    },
    outputId: 'out',
    effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
    channelId: MASTER_CHANNEL_ID,
    pan: 0,
  }
}

/** Render a stereo pair offline and return the settled left-channel value.
 *  Skips the first block (renderer warm-up) and waits out the const glide. */
async function renderSettled(pair: { left: NodeRepr_t; right: NodeRepr_t }): Promise<number> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: 256, sampleRate: 44100 })
  await r.render(pair.left, pair.right)
  const L = new Float32Array(256)
  const R = new Float32Array(256)
  r.process([], [L, R]) // first block is silent while the graph ramps in
  for (let i = 0; i < 8; i++) r.process([], [L, R])
  return L[255]
}

describe('eff module Default param', () => {
  const compile = (inst: ModularInstrument, inletSignals: Record<string, NodeRepr_t> = {}, midiCcValues?: Record<number, number>) =>
    compileModular(inst, el.const({ value: 440 }), el.const({ value: 1 }), 'voice', [], 1, inletSignals, midiCcValues)

  it('outputs the Default value when no lane and no CC drive the inlet', async () => {
    const { left, right } = compile(makePatch({ cc: 0, default: 0.4 }))
    expect(await renderSettled({ left, right })).toBeCloseTo(0.4, 2)
  })

  it('falls back to 0 when the Default param is missing (old saves)', async () => {
    const { left, right } = compile(makePatch({ cc: 0 }))
    expect(await renderSettled({ left, right })).toBeCloseTo(0, 2)
  })

  it('a bound lane signal overrides the Default value', async () => {
    const { left, right } = compile(makePatch({ cc: 0, default: 0.4 }), { 'Eff In 01': el.const({ value: 0.7 }) })
    expect(await renderSettled({ left, right })).toBeCloseTo(0.7, 2)
  })

  it('adds the live MIDI CC value on top of the Default value', async () => {
    const { left, right } = compile(makePatch({ cc: 5, default: 0.3 }), {}, { 5: 127 })
    expect(await renderSettled({ left, right })).toBeCloseTo(1.3, 2)
  })

  it('holds the Default when the CC is assigned but no MIDI value has arrived', async () => {
    const { left, right } = compile(makePatch({ cc: 5, default: 0.3 }), {}, {})
    expect(await renderSettled({ left, right })).toBeCloseTo(0.3, 2)
  })

  it('an unnamed eff module still emits its Default value', async () => {
    const { left, right } = compile(makePatch({ cc: 0, default: 0.6 }, ''))
    expect(await renderSettled({ left, right })).toBeCloseTo(0.6, 2)
  })
})
