import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { encodeWav } from '../audio/wav'
import { generateWaveform } from '../audio/waveGen'
import { compileModular } from './modular'
import type { SampleMeta } from './instruments'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/**
 * End-to-end "Create Sample" pipeline without a browser: generate PCM →
 * encode 16-bit WAV → parse it back → verify content, then render the parsed
 * PCM through the `wave` module via Elementary's offline renderer + VFS.
 */

/** Minimal 16-bit WAV reader (mirror of encodeWav's layout). */
function readPcm16(wav: ArrayBuffer): { sampleRate: number; channels: number; data: Float32Array[] } {
  const dv = new DataView(wav)
  expect(String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))).toBe('RIFF')
  expect(String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11))).toBe('WAVE')
  const channels = dv.getUint16(22, true)
  const sampleRate = dv.getUint32(24, true)
  const bits = dv.getUint16(34, true)
  expect(bits).toBe(16)
  const dataSize = dv.getUint32(40, true)
  const frames = dataSize / (channels * 2)
  const data: Float32Array[] = []
  for (let c = 0; c < channels; c++) data.push(new Float32Array(frames))
  let off = 44
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      data[c][f] = dv.getInt16(off, true) / 32767
      off += 2
    }
  }
  return { sampleRate, channels, data }
}

/** Frequency from sign changes (both directions) — robust for whole-cycle buffers. */
/** Frequency via up-crossings, skipping the initial const-glide ramp. */
function estimateFreqRendered(samples: Float32Array, sampleRate: number, skip = 2000): number {
  let crossings = 0
  for (let i = skip + 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings++
  }
  return (crossings * sampleRate) / (samples.length - skip)
}

describe('generated sample → WAV → wave module', () => {
  const SR = 44100
  const FRAMES = 11025 // 0.25 s — WAVEFORM_MAX_LENGTH_SECONDS
  const src = generateWaveform('sine', FRAMES)

  it('round-trips through the WAV encoder with only 16-bit quantization', () => {
    const parsed = readPcm16(encodeWav([src], SR))
    expect(parsed.sampleRate).toBe(SR)
    expect(parsed.channels).toBe(1)
    expect(parsed.data[0].length).toBe(FRAMES)
    for (let i = 0; i < FRAMES; i++) {
      const q = Math.round(src[i] * 32767) / 32767
      expect(Math.abs(parsed.data[0][i] - q)).toBeLessThan(1e-6)
    }
  })

  it('renders through the wave module at the note frequency', async () => {
    const meta: SampleMeta = { hash: 'genhash', channels: 1, sampleRate: SR, frames: FRAMES }
    const inst: ModularInstrument = {
      id: 'i1', kind: 'modular', name: 'Test',
      modules: {
        note: { id: 'note', type: 'note', params: {}, pos: { x: 0, y: 0 } },
        wv: { id: 'wv', type: 'wave', params: { sampleIndex: 0, finetune: 0, gain: 1 }, pos: { x: 0, y: 0 } },
        out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
      },
      connections: {
        c1: { id: 'c1', from: { moduleId: 'note', port: 'freq' }, to: { moduleId: 'wv', port: 'freq' }, gain: 1 },
        c2: { id: 'c2', from: { moduleId: 'wv', port: 'out' }, to: { moduleId: 'out', port: 'inL' }, gain: 1 },
      },
      outputId: 'out',
      effectSettings: { ...DEFAULT_EFFECT_SETTINGS },
      channelId: MASTER_CHANNEL_ID,
      pan: 0,
    }
    const { left, right } = compileModular(
      inst,
      el.const({ value: 440 }),
      el.const({ value: 0 }),
      'voice',
      [meta],
      1,
      {},
      undefined,
      undefined,
    )
    const r = new OfflineRenderer()
    await r.initialize({
      numInputChannels: 0, numOutputChannels: 2, blockSize: 512, sampleRate: SR,
      virtualFileSystem: { genhash: src },
    })
    await r.render(left, right)
    const blocks = 40
    const all = new Float32Array(blocks * 512)
    const L = new Float32Array(512)
    const R = new Float32Array(512)
    for (let b = 0; b < blocks; b++) {
      r.process([], [L, R])
      all.set(L, b * 512)
    }
    expect(Math.max(...Array.from(all, Math.abs))).toBeGreaterThan(0.1)
    // The wave module plays one buffer cycle per note period: 440 in → 440 out.
    const f = estimateFreqRendered(all, SR)
    expect(f).toBeGreaterThan(420)
    expect(f).toBeLessThan(460)
  })
})
