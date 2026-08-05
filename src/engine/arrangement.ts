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
}

/**
 * Build the flattened arrangement for the given play mode.
 * Returns an empty array only when no playable content exists (no patterns at all).
 */
export function buildArrangement(
  doc: Doc,
  playMode: 'pattern' | 'section' | 'song',
): ArrangementItem[] {
  switch (playMode) {
    case 'pattern':
      return buildForPattern(doc)
    case 'section':
      return buildForSection(doc)
    case 'song':
      return buildForSong(doc)
  }
}

function buildForPattern(doc: Doc): ArrangementItem[] {
  if (!doc.entities.patterns[doc.patternId]) return []
  return [{ patternId: doc.patternId, startRow: 0 }]
}

function buildForSection(doc: Doc): ArrangementItem[] {
  // Find the section that contains the current pattern.
  const secId = doc.sectionIds.find((sid) => {
    const sec = doc.entities.sections[sid]
    return sec?.patternIds.includes(doc.patternId)
  })
  if (secId) {
    const section = doc.entities.sections[secId]
    if (section) return flattenPatterns(doc, section.patternIds)
  }
  // Current pattern not in any section — fall back to single-pattern.
  return buildForPattern(doc)
}

function buildForSong(doc: Doc): ArrangementItem[] {
  const allPatternIds: Id[] = []
  for (const sid of doc.sectionIds) {
    const sec = doc.entities.sections[sid]
    if (!sec) continue
    for (const pid of sec.patternIds) {
      allPatternIds.push(pid)
    }
  }
  if (allPatternIds.length === 0) return buildForPattern(doc)
  return flattenPatterns(doc, allPatternIds)
}

/** Convert a list of pattern ids into arrangement items with cumulative offsets.
 *  Skips patterns that no longer exist (stale references). */
function flattenPatterns(doc: Doc, patternIds: Id[]): ArrangementItem[] {
  const items: ArrangementItem[] = []
  let offset = 0
  for (const pid of patternIds) {
    const pat = doc.entities.patterns[pid]
    if (!pat) continue // stale reference
    items.push({ patternId: pid, startRow: offset })
    offset += pat.length
  }
  return items
}
