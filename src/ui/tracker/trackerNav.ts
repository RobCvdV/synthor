import type { TrackerCursor } from '../../state/appStore'

export interface Selection {
  startRow: number
  startTrack: number
  endRow: number
  endTrack: number
}

export interface SelectionBounds { r0: number; r1: number; t0: number; t1: number }

export function selectionBounds(sel: Selection): SelectionBounds {
  return {
    r0: Math.min(sel.startRow, sel.endRow), r1: Math.max(sel.startRow, sel.endRow),
    t0: Math.min(sel.startTrack, sel.endTrack), t1: Math.max(sel.startTrack, sel.endTrack),
  }
}

/** Grows `sel` to `to`, or starts one at `from` when there is none. */
export function extendSelection(sel: Selection | null, from: TrackerCursor, to: TrackerCursor): Selection {
  return sel
    ? { ...sel, endRow: to.row, endTrack: to.track }
    : { startRow: from.row, startTrack: from.track, endRow: to.row, endTrack: to.track }
}

/** Moves `n` rows, wrapping around the pattern. */
export function stepRow(c: TrackerCursor, n: number, length: number): TrackerCursor {
  return { ...c, row: (((c.row + n) % length) + length) % length }
}

/** Jumps to the next (or previous) multiple of `step`, wrapping around the pattern. */
export function snapRow(c: TrackerCursor, step: number, dir: 1 | -1, length: number): TrackerCursor {
  const last = Math.floor((length - 1) / step) * step
  if (dir > 0) {
    const next = (Math.floor(c.row / step) + 1) * step
    return { ...c, row: next < length ? next : 0 }
  }
  const prev = (Math.ceil(c.row / step) - 1) * step
  return { ...c, row: prev >= 0 ? prev : last }
}

/** Next column: note → volume → each lane → next track's note. */
export function moveRight(c: TrackerCursor, laneCount: (track: number) => number, trackCount: number): TrackerCursor {
  const lanes = laneCount(c.track)
  if (c.col === 0) return { ...c, col: 1, laneIndex: null }
  if (c.col === 1 && lanes > 0) return { ...c, col: 2, laneIndex: 0 }
  if (c.col >= 2 && c.laneIndex !== null && c.laneIndex < lanes - 1) return { ...c, col: c.col + 1, laneIndex: c.laneIndex + 1 }
  return { ...c, col: 0, laneIndex: null, track: (c.track + 1) % trackCount }
}

/** Previous column; from a note column it lands on the previous track's last column. */
export function moveLeft(c: TrackerCursor, laneCount: (track: number) => number, trackCount: number): TrackerCursor {
  if (c.col >= 2 && c.laneIndex !== null && c.laneIndex > 0) return { ...c, col: c.col - 1, laneIndex: c.laneIndex - 1 }
  if (c.col >= 2) return { ...c, col: 1, laneIndex: null }
  if (c.col === 1) return { ...c, col: 0, laneIndex: null }
  const track = (c.track - 1 + trackCount) % trackCount
  const lanes = laneCount(track)
  return lanes > 0 ? { ...c, track, col: 1 + lanes, laneIndex: lanes - 1 } : { ...c, track, col: 1, laneIndex: null }
}

/**
 * Two-digit hex entry: the first digit writes `hex·16` and waits for the second,
 * which completes the byte. Values are normalized to 0..1.
 */
export function enterHexDigit(pending: number | null, hex: number): { value: number; pending: number | null } {
  return pending === null
    ? { value: (hex * 16) / 255, pending: hex }
    : { value: (pending * 16 + hex) / 255, pending: null }
}
