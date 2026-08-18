import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { renderDrumKitSlot } from './instruments'
import type { DrumKitSlot } from '../domain/types'

/** Tests the table-based one-shot drumkit sample player against Elementary's
 *  real native nodes via the offline renderer — verifies the normalized table
 *  index, the gate-edge phase reset, and the running window. */

const HASH = 'test-kick-hash'
const SR = 44100
const FRAMES = 4800

// Distinctive shape: sharp onset ramp, a wide mid pulse, decaying tail —
// index normalization bugs show up as misplaced or missing features. The
// pulse is ~11 samples wide because the table linearly interpolates and a
// 1-sample spike would smear to nothing.
const kick = new Float32Array(FRAMES)
for (let i = 0; i < FRAMES; i++) kick[i] = Math.sin(i / 90) * 0.3 * (1 - i / FRAMES)
for (let i = 0; i < 100; i++) kick[i] = (i / 100) * 0.8
for (let i = 495; i <= 505; i++) kick[i] = 0.7

// baseNote 60 = natural playback rate (midiToFreq(60)/midiToFreq(60) = 1),
// so the left output equals the raw sample data sample-for-sample.
const slot: DrumKitSlot = {
  id: 's1', note: 40, sampleId: 'k1', instrumentId: null, baseNote: 60, volume: 1, pan: -1,
}
const meta = [{ hash: HASH, channels: 1, sampleRate: SR, frames: FRAMES }]
const hashById = { k1: HASH }

/** Render with the gate held for whole blocks listed in `gateBlocks`.
 *  Gate at block ≥ 7: Elementary's const nodes glide ~882 samples at render. */
async function renderKick(gateBlocks: number[], blocks: number): Promise<Float32Array> {
  const pair = renderDrumKitSlot(
    slot, {}, el.in({ channel: 0 }), el.in({ channel: 1 }), 'voice', meta, hashById,
  )
  const r = new OfflineRenderer()
  // Render only the left output: mono slots share the same subgraph node in
  // both channels and the offline renderer handles the duplicate keyed table
  // poorly (the real WebRenderer dedups the shared subtree).
  await r.initialize({
    numInputChannels: 2, numOutputChannels: 1, blockSize: 128, sampleRate: SR,
    virtualFileSystem: { [HASH]: kick },
  })
  await r.render(pair.left)
  const gates = new Set(gateBlocks)
  const all = new Float32Array(blocks * 128)
  const in0 = new Float32Array(128)
  const in1 = new Float32Array(128)
  const L = new Float32Array(128)
  for (let b = 0; b < blocks; b++) {
    in0.fill(gates.has(b) ? 1 : 0)
    r.process([in0, in1], [L])
    all.set(L, b * 128)
  }
  return all
}

/** The edge sample already advances the phase one step, so out[base + k]
 *  reads kick[k + 1]; allow a one-sample window either way. */
function nearKickAt(out: Float32Array, sample: number, kickSample: number): boolean {
  return [kickSample - 1, kickSample, kickSample + 1].some(
    (k) => k >= 0 && k < FRAMES && Math.abs(out[sample] - kick[k]) < 0.05,
  )
}

describe('drumkit table one-shot', () => {
  it('plays the sample from sample 0 on the gate edge', async () => {
    const out = await renderKick([20], 60)
    const base = 20 * 128
    expect(Math.abs(out[base])).toBeLessThan(0.02)
    expect(nearKickAt(out, base + 98, 100)).toBe(true) // onset ramp end ≈ 0.8
    expect(nearKickAt(out, base + 499, 500)).toBe(true) // mid pulse 0.7
  })

  it('retriggers from sample 0 on the next gate edge', async () => {
    const out = await renderKick([20, 33], 60)
    const base = 33 * 128
    expect(Math.abs(out[base])).toBeLessThan(0.02)
    expect(nearKickAt(out, base + 98, 100)).toBe(true)
    expect(nearKickAt(out, base + 499, 500)).toBe(true)
  })

  it('plays to the end and settles near the last sample', async () => {
    const blocks = Math.ceil((20 * 128 + FRAMES + 600) / 128) + 2
    const out = await renderKick([20], blocks)
    const base = 20 * 128
    // Tail decays to ~0; the clamped phase holds the final sample value.
    expect(Math.abs(out[base + FRAMES + 500])).toBeLessThan(0.02)
  })

  it('is exactly silent before the first gate edge (no free-run playback)', async () => {
    const out = await renderKick([50], 60)
    for (let i = 0; i < 50 * 128; i++) expect(out[i]).toBe(0)
    expect(nearKickAt(out, 50 * 128 + 98, 100)).toBe(true)
  })
})
