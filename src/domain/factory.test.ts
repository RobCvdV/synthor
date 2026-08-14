import { describe, expect, it } from 'vitest'
import { emptyCells, fitCells, makeId, newTrack, createDefaultDoc, createMasterChannel, createMixChannel, createChannelEffect, cloneInstrument, newModularInstrument, newDrumKitInstrument, nextEffName, buildDxAlgorithm } from '../domain/factory'
import { defaultParams, MODULE_DEFS } from '../domain/moduleDefs'
import { MASTER_CHANNEL_ID } from '../domain/types'

describe('emptyCells', () => {
  it('creates cells with effectLanes', () => {
    const cells = emptyCells(4)
    expect(cells).toHaveLength(4)
    for (const c of cells) {
      expect(c.effectLanes).toEqual({})
      expect(c.note).toBeNull()
      expect(c.volume).toBeNull()
      expect(c.noteOff).toBe(false)
    }
  })
})

describe('fitCells', () => {
  it('pads with empty cells', () => {
    const cells = emptyCells(2)
    cells[0].note = 60
    const fitted = fitCells(cells, 4)
    expect(fitted).toHaveLength(4)
    expect(fitted[0].note).toBe(60)
    expect(fitted[3].note).toBeNull()
    expect(fitted[3].effectLanes).toEqual({})
  })

  it('truncates', () => {
    const cells = emptyCells(4)
    const fitted = fitCells(cells, 2)
    expect(fitted).toHaveLength(2)
  })
})

describe('newTrack', () => {
  it('creates track with effectLanes array', () => {
    const instId = makeId('inst')
    const track = newTrack(instId, 16)
    expect(track.effectLanes).toEqual([])
    expect(track.cells).toHaveLength(16)
  })
})

describe('nextEffName', () => {
  it('starts at Eff In 01 and increments', () => {
    expect(nextEffName([])).toBe('Eff In 01')
    expect(nextEffName(['Eff In 01'])).toBe('Eff In 02')
    expect(nextEffName(['Eff In 01', 'Eff In 02'])).toBe('Eff In 03')
  })

  it('reuses the lowest free number', () => {
    expect(nextEffName(['Eff In 02'])).toBe('Eff In 01')
    expect(nextEffName(['Eff In 01', 'Eff In 03'])).toBe('Eff In 02')
  })

  it('zero-pads numbers so sorting stays lexical', () => {
    const taken = Array.from({ length: 10 }, (_, i) => `Eff In ${String(i + 1).padStart(2, '0')}`)
    expect(nextEffName(taken)).toBe('Eff In 11')
  })

  it('ignores unrelated names', () => {
    expect(nextEffName(['Filter Cutoff', 'LFO Amount'])).toBe('Eff In 01')
  })
})

describe('newModularInstrument', () => {
  it('seeds two uniquely named eff inlets', () => {
    const inst = newModularInstrument('Patch')
    const effs = Object.values(inst.modules).filter((m) => m.type === 'eff')
    expect(effs.map((m) => m.name)).toEqual(['Eff In 01', 'Eff In 02'])
  })
})

describe('defaultParams', () => {
  it('materializes the eff Default param from the registry', () => {
    expect(defaultParams('eff')).toEqual({ cc: 0, default: 0 })
  })

  it('delay/echo time defaults to ticks (tempo-synced)', () => {
    expect(defaultParams('delay').time).toBe(1.25)
    expect(defaultParams('echo').time).toBe(1.25)
  })

  it('conv defaults to a half-dry IR mix with unity gain', () => {
    const p = defaultParams('conv')
    expect(p.sampleIndex).toBe(0)
    expect(p.mix).toBe(0.5)
    expect(p.gain).toBe(1)
    expect(p.width).toBe(1)
  })

  it('stereo delay/echo default to no ping-pong', () => {
    expect(defaultParams('delayS').pingpong).toBe(0)
    expect(defaultParams('echoS').pingpong).toBe(0)
  })

  it('width defaults to natural stereo width', () => {
    expect(defaultParams('width').width).toBe(1)
  })

  it('delay/echo time is a quarter-tick grid up to 16', () => {
    for (const type of ['delay', 'echo'] as const) {
      const time = MODULE_DEFS[type].params.find((p) => p.key === 'time')!
      expect(time.min).toBe(0.25)
      expect(time.max).toBe(16)
      expect(time.step).toBe(0.25)
    }
  })

  it('every non-singleton module type is assigned a palette group', () => {
    for (const [type, def] of Object.entries(MODULE_DEFS)) {
      if (!def.singleton) {
        expect(def.group, `module type '${type}' needs a palette group`).toBeDefined()
      }
    }
  })

  it('noise defaults to normal mode at full level', () => {
    expect(defaultParams('noise')).toEqual({ mode: 0, level: 1 })
  })

  it('wave defaults to the first sample, no finetune', () => {
    expect(defaultParams('wave')).toEqual({ sampleIndex: 0, finetune: 0, gain: 1 })
  })

  it('comp defaults to soft knee, −20 dB, 4:1', () => {
    expect(defaultParams('comp')).toEqual({
      bypass: 0, mode: 1, threshold: -20, ratio: 4, attack: 10, release: 100, knee: 6, makeup: 0,
    })
  })
})

describe('mixer factories', () => {
  it('creates a master channel with constant id', () => {
    const m = createMasterChannel()
    expect(m.id).toBe(MASTER_CHANNEL_ID)
    expect(m.kind).toBe('master')
    expect(m.volume).toBe(1)
    expect(m.pan).toBe(0)
    expect(m.effects).toEqual([])
  })

  it('creates a sub channel with generated id', () => {
    const c = createMixChannel('FX Bus')
    expect(c.id).toMatch(/^chan_/)
    expect(c.kind).toBe('sub')
    expect(c.name).toBe('FX Bus')
  })

  it('creates a channel effect with default params', () => {
    const fx = createChannelEffect('filter')
    expect(fx.id).toMatch(/^chef_/)
    expect(fx.type).toBe('filter')
    expect(fx.params.cutoff).toBe(1200)
  })

  it('creates a compressor channel effect with default params', () => {
    const fx = createChannelEffect('comp')
    expect(fx.type).toBe('comp')
    expect(fx.params.threshold).toBe(-20)
    expect(fx.params.mode).toBe(1)
  })

  it('default doc includes master channel and mixerInstrumentOrder', () => {
    const doc = createDefaultDoc()
    expect(doc.entities.mixChannels[MASTER_CHANNEL_ID]).toBeDefined()
    expect(doc.entities.mixChannels[MASTER_CHANNEL_ID].kind).toBe('master')
    expect(doc.entities.mixerInstrumentOrder.length).toBeGreaterThan(0)
  })

  it('new instruments default to master channel and center pan', () => {
    const mod = newModularInstrument('Test')
    expect(mod.channelId).toBe(MASTER_CHANNEL_ID)
    expect(mod.pan).toBe(0)
    const dk = newDrumKitInstrument('Test')
    expect(dk.channelId).toBe(MASTER_CHANNEL_ID)
    expect(dk.pan).toBe(0)
  })

  it('default doc contains only synth and drum kit instruments', () => {
    const doc = createDefaultDoc()
    for (const inst of Object.values(doc.entities.instruments)) {
      expect(['modular', 'drumkit']).toContain(inst.kind)
    }
  })

  it('clone preserves channelId and pan', () => {
    const orig = newModularInstrument('Orig')
    orig.channelId = 'some-chan'
    orig.pan = 0.5
    const copy = cloneInstrument(orig, 'Copy')
    expect(copy.kind).toBe('modular')
    if (copy.kind === 'modular') {
      expect(copy.channelId).toBe('some-chan')
      expect(copy.pan).toBe(0.5)
    }
  })
})

describe('buildDxAlgorithm', () => {
  it('builds 4 dxop modules with unique ids for every algorithm', () => {
    for (let alg = 1; alg <= 8; alg++) {
      const { modules } = buildDxAlgorithm(alg, 'out', 'gate', { x: 0, y: 0 })
      const ops = modules.filter((m) => m.type === 'dxop')
      expect(ops).toHaveLength(4)
      expect(new Set(modules.map((m) => m.id)).size).toBe(7)
    }
  })

  it('wires the expected cord totals per algorithm', () => {
    // mod cords + carrier cords + 4 envelope/output cords (mix→gain, gain→out, gate→adsr, adsr→gain.mod).
    const expected: Record<number, number> = { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 10, 7: 8, 8: 8 }
    for (let alg = 1; alg <= 8; alg++) {
      const { connections } = buildDxAlgorithm(alg, 'out', 'gate', { x: 0, y: 0 })
      expect(connections).toHaveLength(expected[alg])
      expect(new Set(connections.map((c) => c.id)).size).toBe(connections.length)
      expect(connections.every((c) => c.to.port !== 'inL' || c.to.moduleId === 'out')).toBe(true)
    }
  })

  it('algorithm 1 is the classic 4→3→2→1 stack with op 1 as the only carrier', () => {
    const { modules, connections } = buildDxAlgorithm(1, 'out', 'gate', { x: 0, y: 0 })
    // Modules are returned op4 first (top of the column), then mix, gain, adsr.
    const id = (n: number) => modules[4 - n].id
    const mixId = modules[4].id
    const mod = (from: number, to: number) =>
      expect.objectContaining({ from: { moduleId: id(from), port: 'out' }, to: { moduleId: id(to), port: 'mod' } })
    expect(connections).toContainEqual(mod(4, 3))
    expect(connections).toContainEqual(mod(3, 2))
    expect(connections).toContainEqual(mod(2, 1))
    expect(connections).toContainEqual(
      expect.objectContaining({ from: { moduleId: id(1), port: 'out' }, to: { moduleId: mixId, port: 'a' } }),
    )
  })

  it('algorithm 8 is purely additive: four carriers into the mix, no mod cords', () => {
    const { modules, connections } = buildDxAlgorithm(8, 'out', 'gate', { x: 0, y: 0 })
    const mixId = modules[4].id
    const carrierPorts = connections.filter((c) => c.to.moduleId === mixId).map((c) => c.to.port)
    expect(carrierPorts).toEqual(['a', 'b', 'c', 'd'])
    const opIds = new Set(modules.slice(0, 4).map((m) => m.id))
    expect(connections.filter((c) => c.to.port === 'mod' && opIds.has(c.to.moduleId))).toHaveLength(0)
  })

  it('every algorithm gates its output through gate→adsr→gain', () => {
    for (let alg = 1; alg <= 8; alg++) {
      const { modules, connections } = buildDxAlgorithm(alg, 'out', 'gate', { x: 0, y: 0 })
      const mixId = modules[4].id
      const gainId = modules[5].id
      const adsrId = modules[6].id
      expect(connections).toContainEqual(
        expect.objectContaining({ from: { moduleId: 'gate', port: 'gate' }, to: { moduleId: adsrId, port: 'gate' } }),
      )
      expect(connections).toContainEqual(
        expect.objectContaining({ from: { moduleId: adsrId, port: 'env' }, to: { moduleId: gainId, port: 'mod' } }),
      )
      expect(connections).toContainEqual(
        expect.objectContaining({ from: { moduleId: mixId, port: 'out' }, to: { moduleId: gainId, port: 'in' } }),
      )
      expect(connections).toContainEqual(
        expect.objectContaining({ from: { moduleId: gainId, port: 'out' }, to: { moduleId: 'out', port: 'inL' } }),
      )
    }
  })

  it('throws on unknown algorithms', () => {
    expect(() => buildDxAlgorithm(0, 'out', 'gate', { x: 0, y: 0 })).toThrow(/algorithm/i)
    expect(() => buildDxAlgorithm(9, 'out', 'gate', { x: 0, y: 0 })).toThrow(/algorithm/i)
  })
})
