/**
 * Cues for embedded playback (games): naming the part of a song to play, the
 * track mutes that layer it, and the seamless hand-over from one looping part
 * to the next on the txSeq node. Pure — the headless SongPlayer drives these.
 */

import type { Doc, Id } from '../domain/types'
import { flattenSteps, type ArrangementItem } from '../engine/arrangement'
import { mapPatternTracksToSlots, slicePlaybackData, type PlaybackData } from './playbackData'

/** A section or pattern by name or id (sections win a name clash), or the whole song. */
export type Cue = string | { section: string } | { pattern: string } | { song: true }

export interface CueInfo {
  kind: 'section' | 'pattern'
  id: Id
  name: string
  rows: number
}

/** Every section, then every pattern, as playable cues. */
export function listCues(doc: Doc): CueInfo[] {
  const sections = doc.sectionIds.flatMap((id) => {
    const sec = doc.entities.sections[id]
    if (!sec) return []
    const rows = flattenSteps(doc, [id]).reduce((sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 0), 0)
    return [{ kind: 'section' as const, id, name: sec.name, rows }]
  })
  const patterns = Object.values(doc.entities.patterns).map((p) => ({ kind: 'pattern' as const, id: p.id, name: p.name, rows: p.length }))
  return [...sections, ...patterns]
}

/** The arrangement a cue plays, or null when it names nothing playable. */
export function resolveCue(doc: Doc, cue: Cue): ArrangementItem[] | null {
  const items = cueItems(doc, cue)
  return items.length > 0 ? items : null
}

function cueItems(doc: Doc, cue: Cue): ArrangementItem[] {
  if (typeof cue === 'object' && 'song' in cue) return flattenSteps(doc, doc.sectionIds)
  const sectionId = typeof cue === 'string' || 'section' in cue ? findSection(doc, typeof cue === 'string' ? cue : cue.section) : undefined
  if (sectionId) return flattenSteps(doc, [sectionId])
  if (typeof cue === 'object' && 'section' in cue) return []
  const patternId = findPattern(doc, typeof cue === 'string' ? cue : cue.pattern)
  return patternId ? [{ patternId, startRow: 0 }] : []
}

function findSection(doc: Doc, ref: string): Id | undefined {
  return doc.sectionIds.find((id) => id === ref) ?? doc.sectionIds.find((id) => doc.entities.sections[id]?.name === ref)
}

function findPattern(doc: Doc, ref: string): Id | undefined {
  if (doc.entities.patterns[ref]) return ref
  return Object.values(doc.entities.patterns).find((p) => p.name === ref)?.id
}

/**
 * Slot mute ref values for muted Track #s (1-based), across every pattern.
 * `winningPatternId` is applied last so it wins any slot shared between patterns.
 */
export function trackMuteValues(
  doc: Doc,
  isMuted: (trackNumber: number) => boolean,
  winningPatternId?: Id,
): [key: string, value: number][] {
  const out: [string, number][] = []
  const patterns = Object.values(doc.entities.patterns).sort(
    (a, b) => (a.id === winningPatternId ? 1 : 0) - (b.id === winningPatternId ? 1 : 0),
  )
  for (const pattern of patterns) {
    const trackToSlot = mapPatternTracksToSlots(doc, pattern.id)
    pattern.trackIds.forEach((trackId, ti) => {
      const si = trackToSlot.get(trackId)
      const track = doc.entities.tracks[trackId]
      if (si === undefined || !track) return
      out.push([`tracker:${track.instrumentId}:ts:${si}:mute`, isMuted(ti + 1) ? 0 : 1])
    })
  }
  return out
}

/** `a` then `b`; both built from the same doc, so their slots line up. */
export function concatPlaybackData(a: PlaybackData, b: PlaybackData): PlaybackData {
  return {
    slots: a.slots.map((slot, i) => ({
      ...slot,
      signals: slot.signals.map((sig, c) => sig.concat(b.slots[i]?.signals[c] ?? new Array(b.totalRows).fill(0))),
    })),
    totalRows: a.totalRows + b.totalRows,
    arrangement: [...a.arrangement, ...b.arrangement.map((it) => ({ ...it, startRow: it.startRow + a.totalRows }))],
  }
}

/** `data` repeated (and cut) to exactly `rows` rows. */
export function tilePlaybackData(data: PlaybackData, rows: number): PlaybackData {
  const n = data.totalRows
  const arrangement: ArrangementItem[] = []
  for (let base = 0; n > 0 && base < rows; base += n) {
    for (const it of data.arrangement) if (base + it.startRow < rows) arrangement.push({ ...it, startRow: base + it.startRow })
  }
  return {
    slots: data.slots.map((slot) => ({
      ...slot,
      signals: slot.signals.map((sig) => Array.from({ length: rows }, (_, r) => sig[r % n] ?? 0)),
    })),
    totalRows: rows,
    arrangement,
  }
}

/**
 * The first row ≥ `row + margin` on a `quantum` grid, capped at `total` (the
 * loop end). A cue switch lands there, so the upload has `margin` rows to arrive.
 */
export function nextBoundary(row: number, total: number, quantum: number, margin: number): number {
  const q = quantum > 0 ? quantum : total
  const b = Math.ceil((row + margin) / q) * q
  return Math.max(1, Math.min(total, b))
}

/**
 * Uploads that move a playing loop from `from` to `to` at row `at` without a
 * restart. txSeq keeps its row across `update`s and reads data modulo its
 * length, so the hand-over is staged:
 *   bridge — `from` up to `at`, then `to`: playback runs into `to` at `at`.
 *   settle — sent once inside `to`: `to` before `at` as well, so the wrap
 *            at the end lands on `to`'s top instead of `from`'s.
 *   target — sent after that wrap: plain `to`, looping (rows < `at` read
 *            `to` modulo its length either way).
 */
export interface CueTransition {
  at: number
  bridge: PlaybackData
  settle: PlaybackData
  target: PlaybackData
}

export function planTransition(from: PlaybackData, to: PlaybackData, at: number): CueTransition {
  const cut = Math.max(1, Math.min(at, from.totalRows))
  const head = cut < from.totalRows ? slicePlaybackData(from, 0, cut - 1)! : from
  const { rowOffset: _drop, ...headData } = head
  return {
    at: cut,
    bridge: concatPlaybackData(headData, to),
    settle: concatPlaybackData(tilePlaybackData(to, cut), to),
    target: to,
  }
}

export type TransitionStage = 'bridge' | 'settle'

export interface TransitionStep {
  /** Upload due now — the hand-over moved on: `settle` data, or the final `target`. */
  send: 'settle' | 'target' | null
  /** Which cue the row belongs to, and the row within it. */
  sounding: 'from' | 'to'
  row: number
}

/**
 * One txSeq row report during a hand-over. `landed`: the current stage's
 * upload has reached the node, so rows describe its data. Settle goes out once
 * a row ≥ `at` shows playback inside `to`; target once a row < `at` shows the
 * wrap onto `to`'s top.
 */
export function stepTransition(plan: CueTransition, stage: TransitionStage, landed: boolean, row: number): TransitionStep {
  if (stage === 'bridge' && !(landed && row >= plan.at)) {
    return row < plan.at ? { send: null, sounding: 'from', row } : { send: null, sounding: 'to', row: row - plan.at }
  }
  const send = stage === 'bridge' ? 'settle' : landed && row < plan.at ? 'target' : null
  return { send, sounding: 'to', row: row >= plan.at ? row - plan.at : row % plan.target.totalRows }
}
