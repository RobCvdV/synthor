import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { newModularInstrument, newSampleEntity } from '../domain/factory'
import type { InstrumentBundle } from '../domain/instrumentBundle'
import type { ModularInstrument } from '../domain/types'
import { packInstrumentFile, parseInstrumentJson, serializeInstrumentBundle, unpackInstrumentFile } from './instrumentFile'
import { CURRENT_SCHEMA_VERSION } from './serialize'

function sampleSynth(): InstrumentBundle {
  const synth = newModularInstrument('Keys')
  const smp = newSampleEntity('Piano C', 'abc123', 'piano.wav', 48000, 1, 480)
  synth.modules.s = { id: 's', type: 'sample', params: { gain: 1 }, pos: { x: 0, y: 0 }, sampleId: smp.id }
  return { rootId: synth.id, instruments: { [synth.id]: synth }, samples: { [smp.id]: smp } }
}

describe('instrument files', () => {
  it('round-trips a bundle and its sample bytes through a zip', async () => {
    const bundle = sampleSynth()
    const zip = await packInstrumentFile(bundle, async (hash) => (hash === 'abc123' ? new Uint8Array([1, 2, 3]).buffer : null))
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['instrument.json', 'samples/abc123.bin'])

    const { bundle: back, sampleData } = unpackInstrumentFile(zip)
    expect(back).toEqual(bundle)
    expect([...sampleData.abc123]).toEqual([1, 2, 3])
  })

  it('leaves out samples whose bytes are missing', async () => {
    const zip = await packInstrumentFile(sampleSynth(), async () => null)
    expect(Object.keys(unzipSync(zip))).toEqual(['instrument.json'])
    expect(unpackInstrumentFile(zip).sampleData).toEqual({})
  })

  it('carries library metadata, normalizing its tags', async () => {
    const meta = { category: ' Keys ', tags: ['Warm', 'warm', ' soft '], createdAt: 'c', modifiedAt: 'm' }
    const zip = await packInstrumentFile(sampleSynth(), async () => null, meta)
    expect(unpackInstrumentFile(zip).meta).toEqual({ category: 'Keys', tags: ['warm', 'soft'], createdAt: 'c', modifiedAt: 'm' })
  })

  it('reads plain instrument JSON', () => {
    const bundle = sampleSynth()
    const { bundle: back } = unpackInstrumentFile(strToU8(serializeInstrumentBundle(bundle)))
    expect(back).toEqual(bundle)
  })

  it('migrates an older bundle like a song (v12 sampleIndex → sampleId)', () => {
    const bundle = sampleSynth()
    const synth = bundle.instruments[bundle.rootId] as ModularInstrument
    const { sampleId: _, ...old } = synth.modules.s
    synth.modules.s = { ...old, params: { sampleIndex: 0, gain: 1 } }
    const text = JSON.stringify({ format: 'synthor-instrument', schemaVersion: 12, bundle })

    const migrated = parseInstrumentJson(text).bundle.instruments[bundle.rootId] as ModularInstrument
    expect(migrated.modules.s.sampleId).toBe(Object.keys(bundle.samples)[0])
    expect(migrated.modules.s.params).toEqual({ gain: 1 })
  })

  it('imports legacy `.synthor.inst.json` exports', () => {
    const synth = newModularInstrument('Old Lead')
    const { bundle: b, meta } = parseInstrumentJson(JSON.stringify({ schemaVersion: 1, instrument: synth }))
    expect(meta).toBeNull()
    expect(b.rootId).toBe(synth.id)
    expect(b.instruments[synth.id].name).toBe('Old Lead')
    expect(b.samples).toEqual({})
  })

  it('rejects files that are not instruments', () => {
    expect(() => parseInstrumentJson('{"hello":1}')).toThrow(/Not a valid/)
    expect(() => parseInstrumentJson(JSON.stringify({ schemaVersion: 1, instrument: { id: 'x', kind: 'osc' } }))).toThrow(/Unknown/)
    expect(() => unpackInstrumentFile(zipSync({ 'song.json': strToU8('{}') }))).toThrow(/instrument.json/)
    const noRoot = { format: 'synthor-instrument', schemaVersion: CURRENT_SCHEMA_VERSION, bundle: { rootId: 'x', instruments: {}, samples: {} } }
    expect(() => parseInstrumentJson(JSON.stringify(noRoot))).toThrow(/missing its instrument/)
  })
})
