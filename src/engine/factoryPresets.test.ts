import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { compileModular } from './modular'
import { FACTORY_INSTRUMENTS, type FactoryInstrument } from '../domain/presets/factoryInstruments'
import { midiToFreq } from '../domain/notes'

const SR = 44100
const BLOCK = 512
const HOLD_S = 1

/** Where each preset is played: basses low, leads high, drums around their tuning. */
const NOTE: Record<string, number> = { Bass: 36, Lead: 72, Pad: 60, Keys: 60, Pluck: 60, Drums: 48 }
/** Loudest 50 ms window, dBFS: pads sit back, the kick leads, hats stay under. */
const LOUDNESS: Record<string, number> = { 'warm-pad': -13, 'string-machine': -13, 'glass-pad': -13, 'synth-kick': -8, 'hi-hat': -15 }

interface Measured {
  peak: number
  loudest: number
  tail: number
  finite: boolean
}

/** Holds a note for a second, lets it ring out for five release time constants. */
async function measure(preset: FactoryInstrument): Promise<Measured> {
  const inst = preset.build()
  const release = Math.max(...Object.values(inst.modules).filter((m) => m.type === 'adsr').map((m) => m.params.release))
  const blocks = Math.ceil((HOLD_S + 5 * release + 0.2) * SR / BLOCK)
  const gate = el.le(el.time(), el.const({ value: HOLD_S * SR }))
  const note = preset.id === 'synth-kick' ? 36 : NOTE[preset.category]
  const out = compileModular(inst, el.const({ value: midiToFreq(note) }), gate, 'v', {}, 1, {})
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 2, blockSize: BLOCK, sampleRate: SR })
  await r.render(out.left, out.right)

  const win = Math.round(0.05 * SR)
  const ring: number[] = []
  let sum = 0
  let loudest = 0
  let peak = 0
  let finite = true
  let tail = 0
  const tailFrom = (blocks - Math.ceil(0.1 * SR / BLOCK)) * BLOCK
  const L = new Float32Array(BLOCK)
  const R = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    r.process([], [L, R])
    for (let i = 0; i < BLOCK; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) finite = false
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
      const e = (L[i] * L[i] + R[i] * R[i]) / 2
      ring.push(e)
      sum += e
      if (ring.length > win) sum -= ring.shift()!
      if (ring.length === win) loudest = Math.max(loudest, sum / win)
      if (b * BLOCK + i >= tailFrom) tail = Math.max(tail, e)
    }
  }
  const db = (x: number) => 10 * Math.log10(x + 1e-12)
  return { peak, loudest: db(loudest), tail: db(tail), finite }
}

describe('factory instruments, rendered', () => {
  for (const preset of FACTORY_INSTRUMENTS) {
    it(`${preset.id} plays at its loudness and dies away after release`, async () => {
      const m = await measure(preset)
      expect(m.finite).toBe(true)
      expect(m.loudest).toBeGreaterThan((LOUDNESS[preset.id] ?? -10) - 1)
      expect(m.loudest).toBeLessThan((LOUDNESS[preset.id] ?? -10) + 1)
      expect(m.peak).toBeLessThan(1.2)
      expect(m.tail).toBeLessThan(m.loudest - 30)
    })
  }
})
