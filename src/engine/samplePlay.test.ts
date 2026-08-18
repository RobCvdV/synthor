import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { makeSampleLoop } from './samplePlay'

const HASH = 'loop-hash'
const SR = 44100
const FRAMES = 8820 // 0.2 s — one full cycle of the probe sine
const probe = new Float32Array(FRAMES)
for (let i = 0; i < FRAMES; i++) probe[i] = Math.sin((2 * Math.PI * i) / FRAMES)

async function renderLoop(rate: number, blocks: number): Promise<Float32Array> {
  const ch = makeSampleLoop('voice:loop', HASH, 1, el.const({ value: rate }), FRAMES, SR)
  const r = new OfflineRenderer()
  await r.initialize({
    numInputChannels: 0, numOutputChannels: 1, blockSize: 128, sampleRate: SR,
    virtualFileSystem: { [HASH]: probe },
  })
  await r.render(ch[0])
  const all = new Float32Array(blocks * 128)
  const out = new Float32Array(128)
  for (let b = 0; b < blocks; b++) {
    r.process([], [out])
    all.set(out, b * 128)
  }
  return all
}

/** Period of the loop in samples, measured via up-crossings past the
 *  const-glide ramp. */
function periodOf(samples: Float32Array, skip = 2000): number {
  const crossings: number[] = []
  for (let i = skip + 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i)
  }
  if (crossings.length < 3) return -1
  return (crossings[crossings.length - 1] - crossings[1]) / (crossings.length - 2)
}

describe('makeSampleLoop', () => {
  it('rate 1 loops once per file duration', async () => {
    const out = await renderLoop(1, 400)
    const period = periodOf(out)
    expect(Math.abs(period - FRAMES)).toBeLessThan(3)
  })

  it('rate 0.5 loops at half speed (double the period)', async () => {
    const out = await renderLoop(0.5, 700)
    const period = periodOf(out)
    expect(Math.abs(period - 2 * FRAMES)).toBeLessThan(3)
  })
})
