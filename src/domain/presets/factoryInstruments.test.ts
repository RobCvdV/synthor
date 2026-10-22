import { describe, expect, it } from 'vitest'
import { normalizeTags } from '../library'
import { MODULE_DEFS } from '../moduleDefs'
import { FACTORY_INSTRUMENTS } from './factoryInstruments'
import { buildPatch } from './patchBuilder'

const CATEGORIES = ['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Drums']

describe('FACTORY_INSTRUMENTS', () => {
  const built = FACTORY_INSTRUMENTS.map((p) => ({ preset: p, inst: p.build() }))

  it('has 20 presets with unique ids and names, known categories and normalized tags', () => {
    expect(FACTORY_INSTRUMENTS).toHaveLength(20)
    expect(new Set(FACTORY_INSTRUMENTS.map((p) => p.id)).size).toBe(20)
    expect(new Set(built.map(({ inst }) => inst.name)).size).toBe(20)
    for (const { preset } of built) {
      expect(CATEGORIES, preset.id).toContain(preset.category)
      expect(preset.tags.length, preset.id).toBeGreaterThan(0)
      expect(normalizeTags(preset.tags), preset.id).toEqual(preset.tags)
    }
  })

  it('builds the same instrument every time', () => {
    for (const p of FACTORY_INSTRUMENTS) expect(p.build(), p.id).toEqual(p.build())
  })

  it('wires only existing ports and keeps every value within its slider range', () => {
    for (const { preset, inst } of built) {
      for (const m of Object.values(inst.modules)) {
        for (const def of MODULE_DEFS[m.type].params) {
          const v = m.params[def.key]
          expect(v >= def.min && v <= def.max, `${preset.id} ${m.id}.${def.key} = ${v}`).toBe(true)
        }
      }
      for (const c of Object.values(inst.connections)) {
        const from = inst.modules[c.from.moduleId]
        const to = inst.modules[c.to.moduleId]
        expect(MODULE_DEFS[from.type].outlets, `${preset.id} ${c.id}`).toContain(c.from.port)
        expect(MODULE_DEFS[to.type].inlets, `${preset.id} ${c.id}`).toContain(c.to.port)
        expect(c.gain >= 0 && c.gain <= 2, `${preset.id} ${c.id} gain`).toBe(true)
      }
      expect(inst.modules[inst.outputId].type).toBe('output')
      const effNames = Object.values(inst.modules).filter((m) => m.type === 'eff').map((m) => m.name)
      expect(new Set(effNames).size, preset.id).toBe(effNames.length)
    }
  })

  it('lays modules out without overlaps', () => {
    for (const { preset, inst } of built) {
      const spots = Object.values(inst.modules).map((m) => `${m.pos.x},${m.pos.y}`)
      expect(new Set(spots).size, preset.id).toBe(spots.length)
    }
  })
})

describe('buildPatch', () => {
  it('rejects unknown params and ports', () => {
    expect(() => buildPatch('x', 'X', {}, (b) => { b.add('osc', { cutof: 1 }) })).toThrow(/no param "cutof"/)
    expect(() => buildPatch('x', 'X', {}, (b) => { b.wire(b.note, b.add('osc'), 'pitch') })).toThrow(/no inlet "pitch"/)
    expect(() => buildPatch('x', 'X', {}, (b) => { b.wire(b.add('osc').port('outR'), b.output, 'inL') })).toThrow(/no outlet "outR"/)
  })

  it('derives ids from the preset id and fills in defaults', () => {
    const inst = buildPatch('demo', 'Demo', { voices: 2, level: 0.5 }, (b) => {
      const o = b.add('osc', { waveform: 3 })
      b.wire(b.note, o, 'freq')
      b.wire(o, b.output, 'inL')
    })
    expect(Object.keys(inst.modules).sort()).toEqual(['demo:gate1', 'demo:note1', 'demo:osc1', 'demo:output1', 'demo:volume1'])
    expect(inst.modules['demo:osc1'].params).toMatchObject({ waveform: 3, gain: 1 })
    expect(inst.modules['demo:output1'].params.gain).toBe(0.5)
    expect(inst.voices).toBe(2)
    expect(Object.values(inst.connections).map((c) => `${c.from.moduleId}.${c.from.port}→${c.to.moduleId}.${c.to.port}`))
      .toEqual(['demo:note1.freq→demo:osc1.freq', 'demo:osc1.out→demo:output1.inL'])
  })
})
