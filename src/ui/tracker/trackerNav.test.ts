import { describe, expect, it } from 'vitest'
import type { TrackerCursor } from '../../state/appStore'
import { enterHexDigit, extendSelection, moveLeft, moveRight, selectionBounds, snapRow, stepRow } from './trackerNav'

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
