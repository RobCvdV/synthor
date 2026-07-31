import { describe, expect, it } from 'vitest'
import { emptyCells, fitCells, makeId, newTrack, createDefaultDoc, createMasterChannel, createMixChannel, createChannelEffect, cloneInstrument, newOscInstrument, newModularInstrument, newDrumKitInstrument } from '../domain/factory'
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
    const osc = newOscInstrument('Test')
    expect(osc.channelId).toBe(MASTER_CHANNEL_ID)
    expect(osc.pan).toBe(0)
    const mod = newModularInstrument('Test')
    expect(mod.channelId).toBe(MASTER_CHANNEL_ID)
    expect(mod.pan).toBe(0)
    const dk = newDrumKitInstrument('Test')
    expect(dk.channelId).toBe(MASTER_CHANNEL_ID)
    expect(dk.pan).toBe(0)
  })

  it('clone preserves channelId and pan', () => {
    const orig = newOscInstrument('Orig')
    orig.channelId = 'some-chan'
    orig.pan = 0.5
    const copy = cloneInstrument(orig, 'Copy')
    expect(copy.kind).toBe('osc')
    if (copy.kind === 'osc') {
      expect(copy.channelId).toBe('some-chan')
      expect(copy.pan).toBe(0.5)
    }
  })
})
