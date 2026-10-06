import {
  copyRange, cutRange, framesOf, insertAt, nearestZeroCrossing, normalizeRange, pasteAt,
  removeDcRange, replaceRange, reverseRange, silenceRange, trimToRange,
  type PcmData,
} from '../../audio/sampleEdit'
import type { Sel } from './selectionGestures'

export interface EditState {
  pcm: PcmData
  sel: Sel | null
  cursor: number | null
}

/** The edited audio plus where the selection and cursor end up. */
export type EditResult = EditState

export function copySelection({ pcm, sel }: EditState): PcmData | null {
  return sel ? copyRange(pcm, sel.start, sel.end) : null
}

/** Removes the selection; the cursor lands where it started. */
export function cutSelection({ pcm, sel }: EditState): (EditResult & { removed: PcmData }) | null {
  if (!sel) return null
  const { data, removed } = cutRange(pcm, sel.start, sel.end)
  return { pcm: data, sel: null, cursor: sel.start, removed }
}

/** Pastes at the cursor, overwriting or shifting later audio; the pasted range ends up selected. */
export function pasteClip({ pcm, cursor }: EditState, clip: PcmData, mode: 'overwrite' | 'insert'): EditResult {
  const at = cursor ?? 0
  const out = mode === 'insert' ? insertAt(pcm, at, clip) : pasteAt(pcm, at, clip)
  return { pcm: out, cursor: at, sel: { start: at, end: Math.min(framesOf(out), at + framesOf(clip)) } }
}

export function replaceSelection({ pcm, sel }: EditState, clip: PcmData): EditResult | null {
  if (!sel) return null
  const out = replaceRange(pcm, sel.start, sel.end, clip)
  return { pcm: out, cursor: sel.start, sel: { start: sel.start, end: Math.min(framesOf(out), sel.start + framesOf(clip)) } }
}

export function reverseSelection(s: EditState): EditResult | null {
  return s.sel ? { ...s, pcm: reverseRange(s.pcm, s.sel.start, s.sel.end) } : null
}

/** The selection, or the whole sample without one. */
export function targetRange({ pcm, sel }: EditState): Sel {
  return sel ?? { start: 0, end: framesOf(pcm) }
}

/** Keeps only the selection, which then covers the whole sample. */
export function trimSelection({ pcm, sel }: EditState): EditResult | null {
  if (!sel) return null
  const out = trimToRange(pcm, sel.start, sel.end)
  return { pcm: out, cursor: 0, sel: null }
}

export function silenceSelection(s: EditState): EditResult | null {
  return s.sel ? { ...s, pcm: silenceRange(s.pcm, s.sel.start, s.sel.end) } : null
}

/** Normalizes the selection (or the whole sample) to full scale. */
export function normalizeSelection(s: EditState): EditResult {
  const r = targetRange(s)
  return { ...s, pcm: normalizeRange(s.pcm, r.start, r.end) }
}

export function removeDcSelection(s: EditState): EditResult {
  const r = targetRange(s)
  return { ...s, pcm: removeDcRange(s.pcm, r.start, r.end) }
}

/** Moves both selection edges to their nearest rising zero crossings. */
export function snapSelection({ pcm, sel }: EditState): Sel | null {
  if (!sel) return null
  const start = nearestZeroCrossing(pcm, sel.start)
  const end = nearestZeroCrossing(pcm, sel.end)
  return end > start ? { start, end } : sel
}
