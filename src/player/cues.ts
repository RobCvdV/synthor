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

/**
 * When a cue takes over a playing one:
 *   'now'  — restart on the new cue's top immediately.
 *   'sync' — swap at once, keeping the row position (layered variations of equal length).
 *   'end'  — when the current loop finishes.
 *   { every: n } — on the next n-row boundary (n = rows per bar for bar-quantized changes).
 * Boundaries count from the top of the cue sounding when the switch lands, so
 * a cue asked for mid hand-over follows the cue that is taking over.
 */
export type CueTiming = 'now' | 'sync' | 'end' | { every: number }

/** One step of `queue()`: a cue and when it takes over from the step before. */
export interface CueStep {
  cue: Cue
  timing?: CueTiming
  /**
   * Carry on where the cue would be had it kept playing since it was left
   * (e.g. a stage after a fill or a detour), instead of from its top.
   */
  resume?: boolean
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
  return trackLevelValues(doc, (n) => (isMuted(n) ? 0 : 1), winningPatternId)
}

/**
 * Slot gain values (the smoothed mute refs, 0..1) for Track #s (1-based)
 * across every pattern; `only` limits them to those Track #s.
 */
export function trackLevelValues(
  doc: Doc,
  levelOf: (trackNumber: number) => number,
  winningPatternId?: Id,
  only?: ReadonlySet<number>,
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
      if (si === undefined || !track || (only && !only.has(ti + 1))) return
      out.push([`tracker:${track.instrumentId}:ts:${si}:mute`, levelOf(ti + 1)])
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
 * `data` starting at its row `start` (and wrapping round to it), so a cue can
 * carry on mid-way instead of from its top.
 */
export function rotatePlaybackData(data: PlaybackData, start: number): PlaybackData {
  const n = data.totalRows
  const s = n > 0 ? ((start % n) + n) % n : 0
  if (s === 0) return data
  const arrangement: ArrangementItem[] = []
  data.arrangement.forEach((it, i) => {
    const end = data.arrangement[i + 1]?.startRow ?? n
    if (it.startRow < s && end > s) arrangement.push({ ...it, startRow: 0 }, { ...it, startRow: it.startRow - s + n })
    else arrangement.push({ ...it, startRow: (it.startRow - s + n) % n })
  })
  return {
    slots: data.slots.map((slot) => ({ ...slot, signals: slot.signals.map((sig) => sig.slice(s).concat(sig.slice(0, s))) })),
    totalRows: n,
    arrangement: arrangement.sort((a, b) => a.startRow - b.startRow),
  }
}

/**
 * Where a cue left at its row `row`, `rowsSince` rows ago, would be now had
 * it kept playing — the row to carry on from.
 */
export function resumeRow(row: number, rowsSince: number, length: number): number {
  return length > 0 ? (((row + rowsSince) % length) + length) % length : 0
}

/** Rows played since a cue started sounding at its row `startRow`, now at (unwrapped) `row` after `loops` wraps. */
export function rowsPlayed(startRow: number, loops: number, row: number, length: number): number {
  return loops * length + row - startRow
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
  /** Where `from`'s own rows start in the node's rows, and its length — for reporting its rows. */
  fromStart: number
  fromLength: number
  /** `to`'s cue row at its first row (`to` is rotated to start there; 0 from its top). */
  toOffset: number
}

/**
 * `from` is the data on the node (a plain cue, or a running hand-over's data);
 * `fromView` says which rows of it the sounding cue occupies.
 */
export function planTransition(
  from: PlaybackData,
  to: PlaybackData,
  at: number,
  fromView: { start: number; length: number } = { start: 0, length: from.totalRows },
  toOffset = 0,
): CueTransition {
  const cut = Math.max(1, Math.min(at, from.totalRows))
  const head = cut < from.totalRows ? slicePlaybackData(from, 0, cut - 1)! : from
  const { rowOffset: _drop, ...headData } = head
  return {
    at: cut,
    bridge: concatPlaybackData(headData, to),
    settle: concatPlaybackData(tilePlaybackData(to, cut), to),
    target: to,
    fromStart: fromView.start,
    fromLength: fromView.length,
    toOffset,
  }
}

/** What the node plays: its data, and where the sounding cue's rows sit in it. */
export interface NodeView {
  data: PlaybackData
  /** Node row of the sounding cue's row 0 (cue row = (row − start) mod length). */
  start: number
  length: number
  /** Latest node row a new switch may land on. */
  limit: number
}

/** A running hand-over as the player tracks it. */
export interface RunningTransition extends CueTransition {
  stage: TransitionStage
}

/**
 * The node's view at node row `row`, with `steady` the plain cue's data when
 * no hand-over runs (rotated to start at its cue row `offset`). Before `at` the
 * old cue sounds and a new switch may not land later than `at`; from `at` on
 * the hand-over's target does. Once the settle data wraps, its rows before
 * `at` hold the target tiled from its first row, so a switch lands before `at`.
 */
export function nodeView(steady: PlaybackData, running: RunningTransition | null, row: number, offset = 0): NodeView {
  if (!running) {
    // a switch too close to the loop's end lands in the next loop: the bridge plays it on
    const n = steady.totalRows
    return { data: tilePlaybackData(steady, 2 * n), start: -offset, length: n, limit: 2 * n }
  }
  const { at, target, toOffset } = running
  if (running.stage === 'bridge' && row < at) {
    return { data: running.bridge, start: running.fromStart, length: running.fromLength, limit: at }
  }
  if (row < at) return { data: running.settle, start: -toOffset, length: target.totalRows, limit: at }
  return { data: running.settle, start: at - toOffset, length: target.totalRows, limit: at + target.totalRows }
}

/**
 * A plain loop about to wrap: an upload sent now may land before or after the
 * wrap, so no switch can be placed safely — plan it once the wrap is seen.
 * (Loops too short to ever be clear of their wrap are planned regardless.)
 */
export function mustWaitForWrap(steady: PlaybackData, running: RunningTransition | null, row: number, margin: number): boolean {
  const n = steady.totalRows
  return !running && n > 2 * margin && n - row <= margin
}

/**
 * Node row where a switch on the sounding cue's `quantum`-row grid lands,
 * `margin` rows ahead at least. The grid restarts at the cue's top, and its
 * end counts as a grid line; past it the switch lands in the next loop.
 */
export function switchRow(view: NodeView, row: number, quantum: number, margin: number): number {
  const n = view.length
  const cueRow = (((row - view.start) % n) + n) % n
  const q = quantum > 0 ? Math.min(quantum, n) : n
  const want = cueRow + margin
  const inLoop = Math.ceil(want / q) * q
  const boundary = inLoop <= n ? inLoop : n + Math.ceil((want - n) / q) * q
  return Math.min(view.limit, row + (boundary - cueRow))
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
    if (row >= plan.at) return { send: null, sounding: 'to', row: (row - plan.at + plan.toOffset) % plan.target.totalRows }
    const fromRow = (((row - plan.fromStart) % plan.fromLength) + plan.fromLength) % plan.fromLength
    return { send: null, sounding: 'from', row: fromRow }
  }
  const send = stage === 'bridge' ? 'settle' : landed && row < plan.at ? 'target' : null
  const n = plan.target.totalRows
  return { send, sounding: 'to', row: ((row >= plan.at ? row - plan.at : row) + plan.toOffset) % n }
}
