import {
  copyRange, cutRange, fadeRange, framesOf, gainRange, insertAt, nearestZeroCrossing, normalizeRange, pasteAt,
  removeDcRange, repitchRange, replaceRange, reverseRange, silenceRange, trimToRange,
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

/** Scales the selection by `percent` (100 = unchanged). */
export function gainSelection(s: EditState, percent: number): EditResult | null {
  return s.sel ? { ...s, pcm: gainRange(s.pcm, s.sel.start, s.sel.end, percent / 100) } : null
}

/** Ramps the selection's level from `fromPercent` to `toPercent`. */
export function fadeSelection(s: EditState, fromPercent: number, toPercent: number): EditResult | null {
  return s.sel ? { ...s, pcm: fadeRange(s.pcm, s.sel.start, s.sel.end, fromPercent / 100, toPercent / 100) } : null
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

/** Repitches the selection (or the whole sample) by resampling; the result stays selected. */
export function repitchSelection(s: EditState, semitones: number): EditResult {
  const r = targetRange(s)
  const out = repitchRange(s.pcm, r.start, r.end, semitones)
  const end = r.end + framesOf(out) - framesOf(s.pcm)
  return { pcm: out, cursor: s.cursor === null ? null : Math.min(s.cursor, framesOf(out)), sel: s.sel && { start: r.start, end } }
}

/** Moves both selection edges to their nearest rising zero crossings. */
export function snapSelection({ pcm, sel }: EditState): Sel | null {
  if (!sel) return null
  const start = nearestZeroCrossing(pcm, sel.start)
  const end = nearestZeroCrossing(pcm, sel.end)
  return end > start ? { start, end } : sel
}
