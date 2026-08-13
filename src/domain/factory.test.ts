import { describe, expect, it } from 'vitest'
import { emptyCells, fitCells, makeId, newTrack, createDefaultDoc, createMasterChannel, createMixChannel, createChannelEffect, cloneInstrument, newModularInstrument, newDrumKitInstrument, nextEffName } from '../domain/factory'
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

  it('delay/echo time is a quarter-tick grid up to 16', () => {
    for (const type of ['delay', 'echo'] as const) {
      const time = MODULE_DEFS[type].params.find((p) => p.key === 'time')!
      expect(time.min).toBe(0.25)
      expect(time.max).toBe(16)
      expect(time.step).toBe(0.25)
    }
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
