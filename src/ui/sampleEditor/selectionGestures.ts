/** Frame range [start, end). */
export interface Sel {
  start: number
  end: number
}

export type Drag =
  | { mode: 'select'; anchor: number }
  | { mode: 'edge-start' }
  | { mode: 'edge-end' }

/** How close (px) a press must be to a selection edge to grab it. */
export const EDGE_PX = 6

export interface Press {
  frame: number
  /** Pointer x in canvas pixels. */
  x: number
  scroll: number
  px: number
  sel: Sel | null
  cursor: number | null
  /** Cmd or Ctrl. */
  mod: boolean
  shift: boolean
}

export interface GestureState {
  sel: Sel | null
  cursor: number | null
  drag: Drag | null
}

/**
 * A press on the waveform: grab a selection edge, move the nearest edge (Cmd/Ctrl),
 * extend to the press (Shift), or start a new selection at the cursor.
 */
export function pointerDown(p: Press): GestureState {
  const { frame, sel } = p
  if (sel && !p.mod && !p.shift) {
    const edgeX = (f: number) => (f - p.scroll) * p.px
    if (Math.abs(edgeX(sel.start) - p.x) <= EDGE_PX) return { sel, cursor: p.cursor, drag: { mode: 'edge-start' } }
    if (Math.abs(edgeX(sel.end) - p.x) <= EDGE_PX) return { sel, cursor: p.cursor, drag: { mode: 'edge-end' } }
  }
  if (p.mod) {
    if (!sel) return { sel, cursor: frame, drag: null }
    let { start, end } = sel
    if (Math.abs(start - frame) <= Math.abs(end - frame)) start = frame
    else end = frame
    return { sel: start <= end ? { start, end } : { start: end, end: start }, cursor: frame, drag: null }
  }
  if (p.shift) {
    const next = sel
      ? frame < sel.start ? { start: frame, end: sel.start } : { start: sel.start, end: frame }
      : { start: p.cursor ?? frame, end: frame }
    return { sel: next, cursor: frame, drag: { mode: 'edge-end' } }
  }
  return { sel: { start: frame, end: frame }, cursor: frame, drag: { mode: 'select', anchor: frame } }
}

/** Dragging: a new selection follows the pointer; a grabbed edge stops at the other edge. */
export function pointerMove(drag: Drag, frame: number, sel: Sel | null, cursor: number | null): { sel: Sel | null; cursor: number | null } {
  if (drag.mode === 'select') {
    return { sel: { start: Math.min(drag.anchor, frame), end: Math.max(drag.anchor, frame) }, cursor: frame }
  }
  if (!sel) return { sel, cursor }
  if (drag.mode === 'edge-start') {
    const start = Math.min(frame, sel.end)
    return { sel: start === sel.end ? null : { start, end: sel.end }, cursor }
  }
  const end = Math.max(frame, sel.start)
  return { sel: end === sel.start ? null : { start: sel.start, end }, cursor }
}

/** A click that never moved places only the cursor. */
export function pointerUp(drag: Drag | null, sel: Sel | null): Sel | null {
  return drag?.mode === 'select' && sel && sel.start === sel.end ? null : sel
}

/** Fits the cursor and selection to a sample that is now `frames` long. */
export function fitToLength(sel: Sel | null, cursor: number | null, frames: number): { sel: Sel | null; cursor: number | null } {
  return {
    sel: sel && sel.start < frames ? { start: sel.start, end: Math.min(sel.end, frames) } : null,
    cursor: cursor === null ? null : Math.min(cursor, frames),
  }
}
