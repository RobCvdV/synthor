import { readableLaneLabel } from '../../domain/effects'
import type { Id, Track } from '../../domain/types'
import type { TrackerCursor } from '../../state/appStore'
import type { CellColumn, ColumnMask, RectClipboard, TrackSnapshot } from '../../state/docStoreTypes'

/** Rows form a rectangle; columns (cursor `col`: 0 note, 1 vol, 2+ lanes) run left to right across tracks. */
export interface Selection {
  startRow: number
  startTrack: number
  startCol: number
  endRow: number
  endTrack: number
  endCol: number
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
    ? { ...sel, endRow: to.row, endTrack: to.track, endCol: to.col }
    : { startRow: from.row, startTrack: from.track, startCol: from.col, endRow: to.row, endTrack: to.track, endCol: to.col }
}

/**
 * The columns `sel` covers on each track from its first to its last: the first track from the
 * start column on, the last up to the end column, everything in between.
 */
export function selectionMasks(sel: Selection, tracks: readonly (Track | undefined)[]): ColumnMask[] {
  const startFirst = sel.startTrack < sel.endTrack || (sel.startTrack === sel.endTrack && sel.startCol <= sel.endCol)
  const [t0, c0, t1, c1] = startFirst
    ? [sel.startTrack, sel.startCol, sel.endTrack, sel.endCol]
    : [sel.endTrack, sel.endCol, sel.startTrack, sel.startCol]
  const masks: ColumnMask[] = []
  for (let t = t0; t <= t1; t++) {
    const from = t === t0 ? c0 : 0
    const to = t === t1 ? c1 : Infinity
    const lanes = tracks[t]?.effectLanes ?? []
    masks.push({
      note: from <= 0 && to >= 0,
      volume: from <= 1 && to >= 1,
      laneIds: lanes.filter((_, li) => from <= 2 + li && to >= 2 + li).map((l) => l.id),
    })
  }
  return masks
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

/** The column under the cursor; null on a lane that no longer exists. */
export function cursorColumn(track: Track | undefined, cur: TrackerCursor): CellColumn | null {
  if (cur.col === 0) return { kind: 'note' }
  if (cur.col === 1) return { kind: 'volume' }
  const lane = cur.laneIndex !== null ? track?.effectLanes[cur.laneIndex] : undefined
  return lane ? { kind: 'lane', laneId: lane.id } : null
}

export interface InterpolationTarget {
  r0: number
  r1: number
  /** Null is the volume column. */
  laneId: Id | null
  label: string
  /** Values already on the first / last selected row. */
  start: number | null
  end: number | null
}

/** The cursor's volume or lane column within the selected rows, or null when there's nothing to fill. */
export function interpolationTarget(track: Track | undefined, cur: TrackerCursor, sel: Selection | null): InterpolationTarget | null {
  if (!track || !sel || cur.col === 0) return null
  const { r0, r1 } = selectionBounds(sel)
  if (r1 <= r0) return null
  if (cur.col === 1) {
    return { r0, r1, laneId: null, label: 'Volume', start: track.cells[r0]?.volume ?? null, end: track.cells[r1]?.volume ?? null }
  }
  const lane = cur.laneIndex !== null ? track.effectLanes[cur.laneIndex] : undefined
  if (!lane) return null
  return {
    r0, r1, laneId: lane.id, label: readableLaneLabel(lane.type),
    start: track.cells[r0]?.effectLanes[lane.id] ?? null, end: track.cells[r1]?.effectLanes[lane.id] ?? null,
  }
}

export interface CellPos { row: number; track: number; col: number }

/** Selection from a drag's anchor to `to`; null while still on the anchor column. */
export function dragSelection(anchor: CellPos, to: CellPos): Selection | null {
  if (anchor.row === to.row && anchor.track === to.track && anchor.col === to.col) return null
  return { startRow: anchor.row, startTrack: anchor.track, startCol: anchor.col, endRow: to.row, endTrack: to.track, endCol: to.col }
}

export interface ScrollView {
  scrollTop: number
  height: number
  /** Height of the sticky header covering the top of the view. */
  headHeight: number
}

/** The scrollTop that shows a row below the sticky header — centred, or the smallest move ('nearest').
 *  Null when no scroll is needed. */
export function scrollTopFor(rowTop: number, rowHeight: number, view: ScrollView, mode: 'center' | 'nearest'): number | null {
  const { scrollTop, height, headHeight } = view
  let next: number
  if (mode === 'center') next = rowTop - headHeight - (height - headHeight - rowHeight) / 2
  else if (rowTop < scrollTop + headHeight) next = rowTop - headHeight
  else if (rowTop + rowHeight > scrollTop + height) next = rowTop + rowHeight - height
  else return null
  next = Math.max(0, Math.round(next))
  return next === scrollTop ? null : next
}

/** Short description of what Cmd+V would paste, or null when nothing is copied. */
export function clipboardLabel(rect: RectClipboard | null, track: TrackSnapshot | null): string | null {
  if (rect && rect.cells.length > 0) {
    const rows = rect.cells[0].length
    const head = `${rows} row${rows === 1 ? '' : 's'}`
    const masks = rect.columns
    if (rect.cells.length > 1) {
      const partial = masks?.some((m) => !m.note || !m.volume) ? ' (some columns)' : ''
      return `${head} · ${rect.cells.length} tracks${partial}`
    }
    const m = masks?.[0]
    if (!m) return head
    const lanes = (rect.trackLanes[0] ?? []).map((l) => readableLaneLabel(l.type))
    const parts = [...(m.note ? ['note'] : []), ...(m.volume ? ['vol'] : []), ...lanes]
    return `${head} · ${parts.join(', ')}`
  }
  if (track) return `track · ${track.instrument?.name ?? 'instrument'}`
  return null
}
