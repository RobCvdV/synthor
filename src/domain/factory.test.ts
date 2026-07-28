import { describe, expect, it } from 'vitest'
import { emptyCells, fitCells, makeId, newTrack } from '../domain/factory'

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
