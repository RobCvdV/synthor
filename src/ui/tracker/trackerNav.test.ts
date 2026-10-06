import { describe, expect, it } from 'vitest'
import { newTrack } from '../../domain/factory'
import type { TrackerCursor } from '../../state/appStore'
import { clipboardLabel, cursorColumn, dragSelection, enterHexDigit, extendSelection, selectionMasks, interpolationTarget, moveLeft, moveRight, scrollTopFor, selectionBounds, snapRow, stepRow } from './trackerNav'

const at = (row: number, track = 0, col = 0, laneIndex: number | null = null): TrackerCursor => ({ row, track, col, laneIndex })

/** The grid search snapRow replaced, kept as the reference. */
function snapReference(row: number, step: number, dir: 1 | -1, length: number): number {
  const grids: number[] = []
  for (let i = 0; i < length; i += step) grids.push(i)
  if (dir > 0) return grids.find((g) => g > row) ?? grids[0]
  return [...grids].reverse().find((g) => g < row) ?? grids[grids.length - 1]
}

describe('trackerNav', () => {
  it('steps rows with wrap-around', () => {
    expect(stepRow(at(63), 1, 64).row).toBe(0)
    expect(stepRow(at(0), -1, 64).row).toBe(63)
  })

  it('snaps to grid rows like the original grid search', () => {
    for (const length of [16, 30, 64])
      for (const step of [4, 8])
        for (let row = 0; row < length; row++)
          for (const dir of [1, -1] as const)
            expect(snapRow(at(row), step, dir, length).row).toBe(snapReference(row, step, dir, length))
  })

  it('moves right through volume and lanes to the next track, wrapping', () => {
    const lanes = (t: number) => (t === 0 ? 2 : 0)
    const path = [at(0, 0, 0)]
    for (let i = 0; i < 6; i++) path.push(moveRight(path[path.length - 1], lanes, 2))
    expect(path.map((c) => [c.track, c.col, c.laneIndex])).toEqual([
      [0, 0, null], [0, 1, null], [0, 2, 0], [0, 3, 1], [1, 0, null], [1, 1, null], [0, 0, null],
    ])
  })

  it('moves left onto the previous track’s last lane', () => {
    const lanes = (t: number) => (t === 0 ? 2 : 0)
    expect(moveLeft(at(3, 1, 0), lanes, 2)).toEqual(at(3, 0, 3, 1))
    expect(moveLeft(at(3, 0, 0), lanes, 2)).toEqual(at(3, 1, 1, null))
    expect(moveLeft(at(3, 0, 3, 1), lanes, 2)).toEqual(at(3, 0, 2, 0))
    expect(moveLeft(at(3, 0, 2, 0), lanes, 2)).toEqual(at(3, 0, 1, null))
  })

  it('starts a selection at the old cursor and extends an existing one', () => {
    const sel = extendSelection(null, at(2, 0, 1), at(5, 1))
    expect(sel).toEqual({ startRow: 2, startTrack: 0, startCol: 1, endRow: 5, endTrack: 1, endCol: 0 })
    expect(extendSelection(sel, at(5, 1), at(1, 0, 2, 0))).toEqual({ startRow: 2, startTrack: 0, startCol: 1, endRow: 1, endTrack: 0, endCol: 2 })
    expect(selectionBounds({ startRow: 5, startTrack: 2, startCol: 0, endRow: 1, endTrack: 0, endCol: 0 })).toEqual({ r0: 1, r1: 5, t0: 0, t1: 2 })
  })

  it('enters a byte as two hex digits', () => {
    const first = enterHexDigit(null, 0xa)
    expect(first).toEqual({ value: 0xa0 / 255, pending: 0xa })
    expect(enterHexDigit(first.pending, 0x5)).toEqual({ value: 0xa5 / 255, pending: null })
  })
})

describe('interpolationTarget', () => {
  const track = () => {
    const t = newTrack('inst', 16)
    t.effectLanes = [{ id: 'pan', type: 'panning' }]
    for (const c of t.cells) c.effectLanes.pan = null
    t.cells[2].volume = 0.25
    t.cells[6].effectLanes.pan = 1
    return t
  }
  const sel = { startRow: 6, startTrack: 0, startCol: 1, endRow: 2, endTrack: 1, endCol: 1 }

  it('targets the volume column with its existing values', () => {
    expect(interpolationTarget(track(), at(2, 0, 1), sel)).toEqual({ r0: 2, r1: 6, laneId: null, label: 'Volume', start: 0.25, end: null })
  })

  it('targets only the lane under the cursor', () => {
    expect(interpolationTarget(track(), at(2, 0, 2, 0), sel)).toEqual({ r0: 2, r1: 6, laneId: 'pan', label: 'Panning', start: null, end: 1 })
  })

  it('needs a multi-row selection on a volume or lane column', () => {
    expect(interpolationTarget(track(), at(2, 0, 0), sel)).toBeNull()
    expect(interpolationTarget(track(), at(2, 0, 1), null)).toBeNull()
    expect(interpolationTarget(track(), at(2, 0, 1), { ...sel, startRow: 2 })).toBeNull()
    expect(interpolationTarget(track(), at(2, 0, 3, 1), sel)).toBeNull()
    expect(interpolationTarget(undefined, at(2, 0, 1), sel)).toBeNull()
  })
})

describe('cursorColumn', () => {
  const track = () => ({ ...newTrack('inst', 4), effectLanes: [{ id: 'pan', type: 'panning' }] })

  it('maps the cursor to note, volume or its lane', () => {
    expect(cursorColumn(track(), at(0, 0, 0))).toEqual({ kind: 'note' })
    expect(cursorColumn(track(), at(0, 0, 1))).toEqual({ kind: 'volume' })
    expect(cursorColumn(track(), at(0, 0, 2, 0))).toEqual({ kind: 'lane', laneId: 'pan' })
  })

  it('is null on a lane that is gone', () => {
    expect(cursorColumn(track(), at(0, 0, 3, 1))).toBeNull()
    expect(cursorColumn(undefined, at(0, 0, 2, 0))).toBeNull()
  })
})

describe('dragSelection', () => {
  it('spans from the anchor to the hovered cell, in any direction', () => {
    expect(dragSelection({ row: 4, track: 1, col: 1 }, { row: 2, track: 0, col: 0 }))
      .toEqual({ startRow: 4, startTrack: 1, startCol: 1, endRow: 2, endTrack: 0, endCol: 0 })
  })

  it('selects a second column on the same cell, and is null back on the anchor column', () => {
    expect(dragSelection({ row: 4, track: 1, col: 0 }, { row: 4, track: 1, col: 1 })).not.toBeNull()
    expect(dragSelection({ row: 4, track: 1, col: 0 }, { row: 4, track: 1, col: 0 })).toBeNull()
  })
})

describe('selectionMasks', () => {
  const withLanes = (n: number) => ({ ...newTrack('inst', 4), effectLanes: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, type: 'panning' })) })
  const tracks = [withLanes(2), withLanes(0), withLanes(1)]
  const sel = (startTrack: number, startCol: number, endTrack: number, endCol: number) =>
    ({ startRow: 0, startTrack, startCol, endRow: 3, endTrack, endCol })

  it('covers a column range within one track', () => {
    expect(selectionMasks(sel(0, 1, 0, 2), tracks)).toEqual([{ note: false, volume: true, laneIds: ['l0'] }])
    expect(selectionMasks(sel(0, 3, 0, 3), tracks)).toEqual([{ note: false, volume: false, laneIds: ['l1'] }])
  })

  it('runs left to right across tracks, in either drag direction', () => {
    const expected = [
      { note: false, volume: false, laneIds: ['l1'] },
      { note: true, volume: true, laneIds: [] },
      { note: true, volume: true, laneIds: [] },
    ]
    expect(selectionMasks(sel(0, 3, 2, 1), tracks)).toEqual(expected)
    expect(selectionMasks(sel(2, 1, 0, 3), tracks)).toEqual(expected)
  })
})

describe('scrollTopFor', () => {
  // 20px rows, a 300px view with a 40px sticky header.
  const view = (scrollTop: number) => ({ scrollTop, height: 300, headHeight: 40 })

  it('leaves a visible row alone in nearest mode', () => {
    expect(scrollTopFor(100, 20, view(0), 'nearest')).toBeNull()
  })

  it('scrolls a row hidden under the header or below the view just into sight', () => {
    expect(scrollTopFor(100, 20, view(80), 'nearest')).toBe(60)
    expect(scrollTopFor(400, 20, view(0), 'nearest')).toBe(120)
  })

  it('centres a row below the header, never above the top', () => {
    expect(scrollTopFor(400, 20, view(0), 'center')).toBe(240)
    expect(scrollTopFor(20, 20, view(50), 'center')).toBe(0)
    expect(scrollTopFor(400, 20, view(240), 'center')).toBeNull()
  })
})

describe('clipboardLabel', () => {
  const cells = (tracks: number, rows: number) => Array.from({ length: tracks }, () => Array.from({ length: rows }, () => newTrack('i', 1).cells[0]))

  it('describes a copied selection by rows, tracks and columns', () => {
    expect(clipboardLabel({ cells: cells(1, 8), trackLanes: [[]] }, null)).toBe('8 rows')
    expect(clipboardLabel({ cells: cells(1, 1), trackLanes: [[{ id: 'p', type: 'panning' }]], columns: [{ note: false, volume: true, laneIds: ['p'] }] }, null))
      .toBe('1 row · vol, Panning')
    expect(clipboardLabel({ cells: cells(2, 4), trackLanes: [[], []], columns: [{ note: false, volume: true, laneIds: [] }, { note: true, volume: true, laneIds: [] }] }, null))
      .toBe('4 rows · 2 tracks (some columns)')
  })

  it('describes a copied track, or nothing', () => {
    const instrument = { name: 'Bass' } as never
    expect(clipboardLabel(null, { instrument, cells: [], effectLanes: [] })).toBe('track · Bass')
    expect(clipboardLabel(null, null)).toBeNull()
  })
})
