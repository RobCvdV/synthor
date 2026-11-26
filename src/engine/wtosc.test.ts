import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el, type NodeRepr_t } from '@elemaudio/core'
import { WAVETABLE_SHAPES, wavetableShapeIndex, wtosc } from './wavetableShapes'

const SR = 44100
const BLOCK = 512

async function render(node: NodeRepr_t, blocks = 16): Promise<Float32Array> {
  const r = new OfflineRenderer()
  await r.initialize({ numInputChannels: 0, numOutputChannels: 1, blockSize: BLOCK, sampleRate: SR })
  await r.render(node)
  const out = new Float32Array(blocks * BLOCK)
  const buf = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    r.process([], [buf])
    out.set(buf, b * BLOCK)
  }
  // Skip the root's 20 ms fade-in.
  return out.subarray(2048)
}

/** Magnitude at `hz` over the whole signal (Hann-windowed single-bin DFT). */
function magnitude(x: Float32Array, hz: number): number {
  let re = 0, im = 0
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))
    const ph = (2 * Math.PI * hz * i) / SR
    re += x[i] * w * Math.cos(ph)
    im -= x[i] * w * Math.sin(ph)
  }
  return Math.hypot(re, im) / (x.length / 4)
}

const peak = (x: Float32Array) => Math.max(...Array.from(x, Math.abs))

describe('wtosc native node', () => {
  it.each(WAVETABLE_SHAPES.map((name, i) => [name, i] as const))('%s plays normalized and finite', async (_name, shape) => {
    const out = await render(wtosc(shape, el.const({ value: 110 })))
    expect(out.every(Number.isFinite)).toBe(true)
    expect(peak(out)).toBeGreaterThan(0.8)
    expect(peak(out)).toBeLessThan(1.1)
  })

  it('plays the requested pitch', async () => {
    const out = await render(wtosc(wavetableShapeIndex('sine'), el.const({ value: 1000 })))
    expect(magnitude(out, 1000)).toBeGreaterThan(0.9)
    expect(magnitude(out, 1100)).toBeLessThan(0.02)
  })

  it('keeps a high saw free of aliases', async () => {
    // 3.1 kHz: harmonics 1…7 sit below Nyquist; a naive saw would fold
    // harmonic 8 (24.8 kHz) back to 19.3 kHz, harmonic 9 to 16.2 kHz, ….
    const f = 3100
    const out = await render(wtosc(wavetableShapeIndex('saw'), el.const({ value: f })))
    expect(magnitude(out, f)).toBeGreaterThan(0.3)
    for (const n of [8, 9, 10, 11]) {
      const folded = Math.abs(SR - n * f)
      expect(magnitude(out, folded)).toBeLessThan(0.005)
    }
  })

  it('runs backwards on negative frequency and takes a phase offset', async () => {
    const fwd = await render(wtosc(wavetableShapeIndex('saw'), el.const({ value: 200 })))
    const back = await render(wtosc(wavetableShapeIndex('saw'), el.const({ value: -200 })))
    expect(magnitude(back, 200)).toBeGreaterThan(0.3)
    // A saw run backwards is the mirrored ramp: mostly the negation of forward.
    let dot = 0
    for (let i = 0; i < fwd.length; i++) dot += fwd[i] * back[i]
    expect(dot).toBeLessThan(0)

    const half = await render(wtosc(wavetableShapeIndex('sine'), el.const({ value: 200 }), { phase: el.const({ value: 0.5 }) }))
    const plain = await render(wtosc(wavetableShapeIndex('sine'), el.const({ value: 200 })))
    for (let i = 0; i < 200; i++) expect(half[i]).toBeCloseTo(-plain[i], 2)
  })

  it('restarts the cycle on a rising reset edge', async () => {
    // A 37 Hz sine reset by a 10 Hz train: after each rising edge it starts over from sin(0).
    const f = 37
    const out = await render(wtosc(wavetableShapeIndex('sine'), el.const({ value: f }), { reset: el.train(10) }), 40)
    // The train rises every 4410 samples; the rendered window starts 2048 samples in.
    for (let k = 1; k < 4; k++) {
      const start = k * 4410 - 2048
      for (const j of [0, 50, 300, 1000]) expect(out[start + j]).toBeCloseTo(Math.sin((2 * Math.PI * f * j) / SR), 2)
    }
  })

  it('stays silent for an unknown shape', async () => {
    const out = await render(wtosc(999, el.const({ value: 200 })))
    expect(peak(out)).toBe(0)
  })
})
