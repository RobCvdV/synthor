import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { el } from '@elemaudio/core'
import { compileModular } from './modular'
import type { SampleMeta } from './instruments'
import { DEFAULT_EFFECT_SETTINGS, MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'

/** 0.25 s at 44.1 kHz — the maximum eligible waveform length. */
const META_SHORT: SampleMeta = { hash: 'wavehash', channels: 1, sampleRate: 44100, frames: 11025 }
const META_SHORT_2: SampleMeta = { hash: 'wavehash2', channels: 1, sampleRate: 44100, frames: 11025 }
/** 1 s — too long to be a single-cycle waveform, must be filtered out. */
const META_LONG: SampleMeta = { hash: 'longhash', channels: 1, sampleRate: 44100, frames: 44100 }

/** A minimal patch: note → wave.freq, wave.out → output.inL. */
function makeWavePatch(params: Record<string, number>): ModularInstrument {
  return {
    id: 'i1', kind: 'modular', name: 'Test',
    modules: {
      note: { id: 'note', type: 'note', params: {}, pos: { x: 0, y: 0 } },
      wv: { id: 'wv', type: 'wave', params, pos: { x: 0, y: 0 } },
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
}

/** Minimal mock of ParamRefRegistry — records keys and returns el.const nodes. */
function mockParamRefs() {
  const keys = new Set<string>()
  return {
    keys,
    getOrCreate(key: string, value: number) {
      keys.add(key)
      return el.const({ key, value })
    },
  }
}

const compile = (
  inst: ModularInstrument,
  freqHz: number,
  sampleMeta: SampleMeta[],
  paramRefs?: ReturnType<typeof mockParamRefs>,
) =>
  compileModular(
    inst, el.const({ value: freqHz }), el.const({ value: 0 }), 'voice',
    sampleMeta, 1, {}, undefined, paramRefs as never,
  )

/** Visit every Elementary node in a repr tree (see delayTime.test.ts). */
function walkAll(n: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!n || typeof n !== 'object') return
  const node = n as Record<string, unknown>
  if (node.symbol === '__ELEM_NODE__') visit(node)
  const children = node.children
  if (Array.isArray(children)) {
    for (const c of children) walkAll(c, visit)
    return
  }
  if (children && children !== 0) {
    const pair = children as Record<string, unknown>
    walkAll(pair.hd, visit)
    walkAll(pair.tl, visit)
    return
  }
  walkAll(node.hd, visit)
  walkAll(node.tl, visit)
}

/** Collect {kind, props, children} triples in a repr tree. */
function collect(n: unknown): Array<{ kind: string; props: Record<string, unknown>; children: unknown }> {
  const found: Array<{ kind: string; props: Record<string, unknown>; children: unknown }> = []
  walkAll(n, (node) => found.push({
    kind: node.kind as string,
    props: (node.props ?? {}) as Record<string, unknown>,
    children: node.children,
  }))
  return found
}

/** Estimate the frequency of a periodic signal via up-crossings (one per
 *  cycle), skipping the initial const-glide ramp. */
function estimateFreq(samples: Float32Array, sampleRate: number, skip = 2000): number {
  let crossings = 0
  for (let i = skip + 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings++
  }
  return (crossings * sampleRate) / (samples.length - skip)
}

describe('wave module structure', () => {
  it('reads the whole sample as one cycle via table + phasor', () => {
    const refs = mockParamRefs()
    const { left } = compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), 440, [META_SHORT], refs)
    const nodes = collect(left)
    const table = nodes.find((n) => ['table', 'mc.table'].includes(n.kind as string))
    expect(table).toBeDefined()
    expect(table!.props.path).toBe('wavehash')
    expect(nodes.some((n) => n.kind === 'phasor')).toBe(true)
    // The table index is normalized 0..1 — the raw phasor must feed it
    // directly (no duration scaling), so one full sample = one cycle.
    const first = table!.children
    const child = Array.isArray(first)
      ? (first[0] as Record<string, unknown> | undefined)
      : (first as Record<string, unknown> | undefined)?.hd as Record<string, unknown> | undefined
    expect(child?.kind).toBe('phasor')
  })

  it('does not normalize pitch against the sample rate (no :rf: factor)', () => {
    const { left } = compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), 440, [META_SHORT])
    const nodes = collect(left)
    expect(nodes.some((n) => n.kind === 'const' && String(n.props.key ?? '').includes(':rf:'))).toBe(false)
  })

  it('registers live refs for finetune and gain', () => {
    const refs = mockParamRefs()
    compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), 440, [META_SHORT], refs)
    expect(refs.keys.has('i1:wv:finetune')).toBe(true)
    expect(refs.keys.has('i1:wv:gain')).toBe(true)
  })

  it('falls back to silence without an eligible sample', () => {
    const { left } = compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), 440, [])
    expect(collect(left).some((n) => ['table', 'mc.table'].includes(n.kind as string))).toBe(false)
  })

  it('filters out samples longer than the max waveform length', () => {
    // The long sample is ineligible, so index 0 resolves to nothing.
    const { left } = compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), 440, [META_LONG])
    expect(collect(left).some((n) => ['table', 'mc.table'].includes(n.kind as string))).toBe(false)

    // With both, the index maps into the FILTERED list: 0 → short, 1 → none.
    const both0 = compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), 440, [META_SHORT, META_LONG])
    expect(collect(both0.left).find((n) => ['table', 'mc.table'].includes(n.kind as string))?.props.path).toBe('wavehash')
    const both1 = compile(makeWavePatch({ sampleIndex: 1, finetune: 0, gain: 1 }), 440, [META_SHORT, META_LONG])
    expect(collect(both1.left).some((n) => ['table', 'mc.table'].includes(n.kind as string))).toBe(false)
  })

  it('switching sampleIndex swaps the table path', () => {
    const { left } = compile(makeWavePatch({ sampleIndex: 1, finetune: 0, gain: 1 }), 440, [META_SHORT, META_SHORT_2])
    expect(collect(left).find((n) => ['table', 'mc.table'].includes(n.kind as string))?.props.path).toBe('wavehash2')
  })
})

describe('wave module rendering', () => {
  /** One full cycle of a 4 Hz sine spanning exactly 0.25 s (the whole buffer). */
  const pcm = (() => {
    const frames = 11025
    const data = new Float32Array(frames)
    for (let i = 0; i < frames; i++) data[i] = Math.sin((2 * Math.PI * 4 * i) / 44100)
    return data
  })()

  async function renderWave(freqHz: number): Promise<Float32Array> {
    const { left, right } = compile(makeWavePatch({ sampleIndex: 0, finetune: 0, gain: 1 }), freqHz, [META_SHORT])
    const r = new OfflineRenderer()
    await r.initialize({
      numInputChannels: 0, numOutputChannels: 2, blockSize: 512, sampleRate: 44100,
      virtualFileSystem: { wavehash: pcm },
    })
    await r.render(left, right)
    const blocks = 20
    const all = new Float32Array(blocks * 512)
    const L = new Float32Array(512)
    const R = new Float32Array(512)
    for (let b = 0; b < blocks; b++) {
      r.process([], [L, R])
      all.set(L, b * 512)
    }
    return all
  }

  it('plays one buffer cycle per wave: 50 Hz in → ~50 Hz out', async () => {
    const out = await renderWave(50)
    expect(Math.max(...Array.from(out, Math.abs))).toBeGreaterThan(0.1)
    const f = estimateFreq(out, 44100)
    expect(f).toBeGreaterThan(45)
    expect(f).toBeLessThan(55)
  })

  it('doubling the frequency doubles the output pitch', async () => {
    const out = await renderWave(100)
    const f = estimateFreq(out, 44100)
    expect(f).toBeGreaterThan(90)
    expect(f).toBeLessThan(110)
  })
})
