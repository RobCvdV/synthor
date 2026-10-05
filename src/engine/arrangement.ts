/**
 * Arrangement builder — flattens a song's section/pattern structure into a
 * single ordered list of pattern windows for the compile step. Pure function:
 * no React, no Zustand, no audio.
 */

import type { Doc, Id } from '../domain/types'

export interface ArrangementItem {
  patternId: Id
  /** Global row offset within the flattened arrangement. */
  startRow: number
  /** The section step this item plays; absent in pattern mode. */
  sectionId?: Id
  step?: number
}

/** One step of a section: a pattern reference by position, so repeats stay distinct. */
export interface StepRef {
  sectionId: Id
  step: number
}

/**
 * The section step showing the current pattern: `hint` when it still points at it, else the
 * pattern's position in the hinted section, else its first use in any section. Null when no
 * section uses the pattern.
 */
export function resolveStep(doc: Doc, hint: StepRef | null): StepRef | null {
  const pid = doc.patternId
  const hinted = hint && doc.sectionIds.includes(hint.sectionId) ? doc.entities.sections[hint.sectionId] : undefined
  if (hint && hinted) {
    if (hinted.patternIds[hint.step] === pid) return hint
    const idx = hinted.patternIds.indexOf(pid)
    if (idx >= 0) return { sectionId: hint.sectionId, step: idx }
  }
  for (const sid of doc.sectionIds) {
    const idx = doc.entities.sections[sid]?.patternIds.indexOf(pid) ?? -1
    if (idx >= 0) return { sectionId: sid, step: idx }
  }
  return null
}

/**
 * Build the flattened arrangement for the given play mode.
 * Returns an empty array only when no playable content exists (no patterns at all).
 */
export function buildArrangement(
  doc: Doc,
  playMode: 'pattern' | 'section' | 'song',
  current: StepRef | null = null,
): ArrangementItem[] {
  switch (playMode) {
    case 'pattern':
      return buildForPattern(doc)
    case 'section':
      return buildForSection(doc, current)
    case 'song':
      return buildForSong(doc)
  }
}

function buildForPattern(doc: Doc): ArrangementItem[] {
  if (!doc.entities.patterns[doc.patternId]) return []
  return [{ patternId: doc.patternId, startRow: 0 }]
}

function buildForSection(doc: Doc, current: StepRef | null): ArrangementItem[] {
  // The current step's section — never derived from the pattern alone, which playback changes.
  const step = resolveStep(doc, current)
  const items = step ? flattenSteps(doc, [step.sectionId]) : []
  // Current pattern not in any section — fall back to single-pattern.
  return items.length > 0 ? items : buildForPattern(doc)
}

function buildForSong(doc: Doc): ArrangementItem[] {
  const items = flattenSteps(doc, doc.sectionIds)
  return items.length > 0 ? items : buildForPattern(doc)
}

/** Every step of the given sections, with cumulative offsets. Skips stale pattern references. */
function flattenSteps(doc: Doc, sectionIds: Id[]): ArrangementItem[] {
  const items: ArrangementItem[] = []
  let offset = 0
  for (const sectionId of sectionIds) {
    const sec = doc.entities.sections[sectionId]
    if (!sec) continue
    sec.patternIds.forEach((pid, step) => {
      const pat = doc.entities.patterns[pid]
      if (!pat) return
      items.push({ patternId: pid, startRow: offset, sectionId, step })
      offset += pat.length
    })
  }
  return items
}

/** Total rows of an arrangement. */
export function arrangementLength(doc: Doc, arrangement: readonly ArrangementItem[]): number {
  return arrangement.reduce((sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 0), 0)
}

/** Index of the item playing global row `row` (wrapped to the arrangement), or -1. */
export function itemIndexAt(doc: Doc, arrangement: readonly ArrangementItem[], row: number): number {
  const total = arrangementLength(doc, arrangement)
  if (total <= 0) return -1
  const wrapped = ((row % total) + total) % total
  return arrangement.findIndex((a) => wrapped >= a.startRow && wrapped < a.startRow + (doc.entities.patterns[a.patternId]?.length ?? 0))
}

/** Global row to start playing `localRow` of the current step (or the current pattern's first use). */
export function startRowFor(doc: Doc, arrangement: readonly ArrangementItem[], current: StepRef | null, localRow: number): number {
  const item = (current && arrangement.find((a) => a.sectionId === current.sectionId && a.step === current.step && a.patternId === doc.patternId))
    ?? arrangement.find((a) => a.patternId === doc.patternId)
  return (item?.startRow ?? 0) + localRow
}
