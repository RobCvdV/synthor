/**
 * Editing a song's game settings: a starter for a song without them, the
 * text forms the settings editors show (track #s, notes), and edits that keep
 * the settings' references whole (renaming or removing a section, a DJ part).
 * The edits change the settings they're given (an Immer draft).
 */
import { DEFAULT_DJ_RULES, type GameMusic } from './gameMusic'
import { midiToName, nameToMidi } from './notes'
import type { Doc } from './types'

/** Rows a section plays, its patterns end to end */
function sectionRows(doc: Doc, sectionId: string): number {
  const section = doc.entities.sections[sectionId]
  return (section?.patternIds ?? []).reduce((sum, pid) => sum + (doc.entities.patterns[pid]?.length ?? 0), 0)
}

/** Settings to start from: the song's sections in order, each at a middle energy, nothing else yet */
export function starterGame(doc: Doc): GameMusic {
  const bar = doc.tempo.linesPerBeat * 4
  const sections = doc.sectionIds.flatMap((id) => {
    const section = doc.entities.sections[id]
    if (!section) return []
    return [{ cue: section.name, energy: 3, bars: Math.max(1, Math.round(sectionRows(doc, id) / bar)) }]
  })
  return {
    bar,
    song: { start: sections[0]?.cue ?? '', sections },
    dj: { ...DEFAULT_DJ_RULES, groups: {}, stays: [...DEFAULT_DJ_RULES.stays] },
    moods: {},
    drops: {},
    stingers: {},
  }
}

/** Track #s as text: runs joined ("1-4, 6") */
export function formatTracks(tracks: number[]): string {
  const sorted = [...new Set(tracks)].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    runs.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return runs.join(', ')
}

/** Track #s from text ("1-4, 6" or "1 2 3"); anything that isn't one is left out */
export function parseTracks(text: string): number[] {
  const tracks: number[] = []
  for (const part of text.split(/[\s,]+/)) {
    const run = /^(\d+)-(\d+)$/.exec(part)
    if (run) {
      const [lo, hi] = [Number(run[1]), Number(run[2])].sort((a, b) => a - b)
      for (let t = lo; t <= hi; t++) tracks.push(t)
    } else if (/^\d+$/.test(part)) tracks.push(Number(part))
  }
  return [...new Set(tracks.filter((t) => t >= 1))].sort((a, b) => a - b)
}

/** Notes as text, by name ("A-4 C-5") */
export function formatNotes(notes: number[]): string {
  return notes.map(midiToName).join(' ')
}

/** Notes from text: names (A4, A-4, C#5) or MIDI numbers, in order */
export function parseNotes(text: string): number[] {
  return text.split(/[\s,]+/).flatMap((token) => {
    if (/^\d+$/.test(token)) return [Number(token)]
    const midi = nameToMidi(token)
    return midi === null ? [] : [midi]
  })
}

/** A section's cue becomes `to` everywhere the settings follow it: the song's grammar, its start and peak */
export function retargetSection(game: GameMusic, from: string, to: string): void {
  for (const s of game.song.sections) {
    if (s.cue === from) s.cue = to
    if (s.next) s.next = s.next.map((c) => (c === from ? to : c))
  }
  if (game.song.start === from) game.song.start = to
  if (game.song.peak?.cue === from) game.song.peak.cue = to
}

/** Take a section out, and every way into it */
export function removeSection(game: GameMusic, cue: string): void {
  game.song.sections = game.song.sections.filter((s) => s.cue !== cue)
  for (const s of game.song.sections) if (s.next) s.next = s.next.filter((c) => c !== cue)
  if (game.song.start === cue) game.song.start = game.song.sections[0]?.cue ?? ''
  if (game.song.peak?.cue === cue) delete game.song.peak
}

/** Rename a DJ part, in the sections that play with it too */
export function renameGroup(game: GameMusic, from: string, to: string): void {
  if (from === to || !(from in game.dj.groups) || to in game.dj.groups) return
  game.dj.groups = renameKey(game.dj.groups, from, to)
  for (const s of game.song.sections) if (s.toys) s.toys = s.toys.map((t) => (t === from ? to : t))
}

/** Remove a DJ part, from the sections that played with it too */
export function removeGroup(game: GameMusic, name: string): void {
  delete game.dj.groups[name]
  for (const s of game.song.sections) if (s.toys) s.toys = s.toys.filter((t) => t !== name)
}

/** The record with one key renamed, in place in its order; unchanged when `to` is taken */
export function renameKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  if (from === to || !(from in record) || to in record) return record
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k === from ? to : k, v]))
}

/** A name for a new entry that isn't taken yet: `base`, `base 2`… */
export function freeName(taken: Iterable<string>, base: string): string {
  const names = new Set(taken)
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** The cues settings can name, as the player finds them: arranged sections, then patterns */
export function cueNames(doc: Doc): string[] {
  const sections = doc.sectionIds.flatMap((id) => (doc.entities.sections[id] ? [doc.entities.sections[id].name] : []))
  const patterns = Object.values(doc.entities.patterns).map((p) => p.name)
  return [...new Set([...sections, ...patterns])]
}

export function instrumentNames(doc: Doc): string[] {
  return [...new Set(Object.values(doc.entities.instruments).map((i) => i.name))]
}
