import { describe, expect, it } from 'vitest'
import { newTrack } from '../../domain/factory'
import type { TrackerCursor } from '../../state/appStore'
import { cursorColumn, dragSelection, enterHexDigit, extendSelection, interpolationTarget, moveLeft, moveRight, scrollTopFor, selectionBounds, snapRow, stepRow } from './trackerNav'

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
    const sel = extendSelection(null, at(2, 0), at(5, 1))
    expect(sel).toEqual({ startRow: 2, startTrack: 0, endRow: 5, endTrack: 1 })
    expect(extendSelection(sel, at(5, 1), at(1, 0))).toEqual({ startRow: 2, startTrack: 0, endRow: 1, endTrack: 0 })
    expect(selectionBounds({ startRow: 5, startTrack: 2, endRow: 1, endTrack: 0 })).toEqual({ r0: 1, r1: 5, t0: 0, t1: 2 })
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
  const sel = { startRow: 6, startTrack: 0, endRow: 2, endTrack: 1 }

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
    expect(dragSelection({ row: 4, track: 1 }, 2, 0)).toEqual({ startRow: 4, startTrack: 1, endRow: 2, endTrack: 0 })
  })

  it('is null back on the anchor cell', () => {
    expect(dragSelection({ row: 4, track: 1 }, 4, 1)).toBeNull()
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
