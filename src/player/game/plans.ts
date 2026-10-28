/**
 * What a game's music plays for what's happening: the target cue for a mood
 * (or the song's current section in `play`), and the plans that get there:
 * the intro into play, a section entered its own way, play carrying on after
 * an interruption, fills and level-ups. Pure: `GameConductor` turns plans into
 * `SongPlayer` calls.
 */

import type { CueStep, CueTiming } from '../cues'
import { PLAY_MOOD, type GameFill, type GameMusic, type GameSection, type GameStinger } from '../../domain/gameMusic'

export interface GameMusicState {
  /** `play` (the sections) or one of `moods` */
  mood: string
  level: number
  /** Level progress, 0..1 */
  progress: number
  /** The song section playing (by cue) */
  section: string
}

/** What should be sounding: a cue and its layers, and how to enter it */
export interface MusicTarget {
  mood: string
  cue: string
  muted: number[]
  via?: string
  /** A mood's hit: played at once before the cue */
  hit?: string
  resume?: boolean
}

export type MusicPlan =
  /** Cues to play, each after the one before sounds; `lands`: a fill that lands on more */
  | { kind: 'cues'; steps: CueStep[]; lands?: boolean }
  /** Same cue: only the layers change */
  | { kind: 'layers'; muted: number[] }

/** The section by cue, or the song's first; undefined when the song has none */
export function sectionFor(music: GameMusic, cue: string): GameSection | undefined {
  const { sections, start } = music.song
  return sections.find((s) => s.cue === cue) ?? sections.find((s) => s.cue === start) ?? sections[0]
}

/** The target for a state; null for a mood the song has no music for */
export function targetFor(music: GameMusic, state: GameMusicState): MusicTarget | null {
  if (state.mood !== PLAY_MOOD) {
    const mood = music.moods[state.mood]
    return mood ? { mood: state.mood, cue: mood.cue, muted: mood.muted ?? [], ...(mood.hit ? { hit: mood.hit } : {}) } : null
  }
  const section = sectionFor(music, state.section)
  if (!section) return null
  return { mood: PLAY_MOOD, cue: section.cue, muted: section.muted ?? [], via: section.via }
}

/**
 * How to get from what sounds (null: silence) to `to`; null when nothing
 * changes. Play starts through the intro, a section is entered its own way,
 * and play coming back after a mood that `returns` (danger) carries on where
 * it would have been, so the song's progression goes on underneath.
 */
export function planChange(music: GameMusic, from: MusicTarget | null, to: MusicTarget): MusicPlan | null {
  if (!from) return { kind: 'cues', steps: [{ cue: to.cue, timing: 'now' }] }
  if (from.cue === to.cue) {
    return sameTracks(from.muted, to.muted) ? null : { kind: 'layers', muted: to.muted }
  }
  const bar: CueTiming = { every: music.bar }
  const resume = to.resume ? { resume: true } : {}
  const via = (cue: string | undefined): MusicPlan =>
    cue
      ? { kind: 'cues', steps: [{ cue, timing: bar }, { cue: to.cue, timing: 'end', ...resume }] }
      : { kind: 'cues', steps: [{ cue: to.cue, timing: bar, ...resume }] }

  if (to.mood !== PLAY_MOOD) {
    return to.hit
      ? { kind: 'cues', steps: [{ cue: to.hit, timing: 'now' }, { cue: to.cue, timing: 'end' }] }
      : via(undefined)
  }
  // the next section
  if (from.mood === PLAY_MOOD) return via(to.via)
  if (music.moods[from.mood]?.returns) {
    return { kind: 'cues', steps: [{ cue: to.cue, timing: bar, resume: true }] }
  }
  return via(music.intro)
}

/** Where the music goes from one section to another */
export function direction(from: GameSection | undefined, to: GameSection | undefined): GameFill['goes'] {
  if (!from || !to || from === to || to.energy === from.energy) return 'level'
  return to.energy > from.energy ? 'up' : 'down'
}

/** A fill from `fills` going that way and fitting a section of `energy`, at random among those that do */
export function pickFill(
  music: GameMusic,
  goes: GameFill['goes'],
  energy: number,
  random: () => number,
): string | undefined {
  const fits = (music.fills ?? []).filter((f) =>
    f.goes === goes && energy >= (f.minEnergy ?? -Infinity) && energy < (f.maxEnergy ?? Infinity))
  return fits.length > 0 ? fits[Math.min(fits.length - 1, Math.floor(random() * fits.length))].cue : undefined
}

/**
 * A fill for a cascade of `reactions`, `barsSinceFill` after the last one,
 * standing in for a bar of the section; null when none fits
 */
export function fillPlan(
  music: GameMusic,
  sounding: MusicTarget | null,
  reactions: number,
  barsSinceFill = Infinity,
  random: () => number = Math.random,
): MusicPlan | null {
  const fill = music.fill
  if (!fill || sounding?.mood !== PLAY_MOOD || reactions !== fill.minCascade) return null
  if (barsSinceFill < (fill.minBarsApart ?? 0)) return null
  const energy = sectionFor(music, sounding.cue)?.energy ?? 0
  const cue = pickFill(music, 'level', energy, random) ?? (energy >= (fill.minEnergy ?? -Infinity) ? fill.cue : undefined)
  if (!cue) return null
  return {
    kind: 'cues',
    steps: [
      { cue, timing: { every: music.bar } },
      { cue: sounding.cue, timing: 'end', resume: true },
    ],
    lands: true,
  }
}

/**
 * A level-up: a fill on the next bar going where the music goes (else the
 * level-up's own), then `next` (a new section, from its top) or, without one,
 * the section carrying on
 */
export function levelUpPlan(
  music: GameMusic,
  sounding: MusicTarget | null,
  next?: string,
  random: () => number = Math.random,
): MusicPlan | null {
  if (sounding?.mood !== PLAY_MOOD) return null
  const moving = next !== undefined && next !== sounding.cue
  const from = sectionFor(music, sounding.cue)
  const goes = moving ? direction(from, sectionFor(music, next)) : 'level'
  const cue = pickFill(music, goes, from?.energy ?? 0, random) ?? music.levelUp?.cue
  if (!cue) return null
  const after: CueStep = moving ? { cue: next, timing: 'end' } : { cue: sounding.cue, timing: 'end', resume: true }
  return { kind: 'cues', steps: [{ cue, timing: { every: music.bar } }, after], lands: goes !== 'down' }
}

/** Every cue a fill may play */
export function fillCues(music: GameMusic): Set<string> {
  const cues = (music.fills ?? []).map((f) => f.cue)
  if (music.fill) cues.push(music.fill.cue)
  if (music.levelUp) cues.push(music.levelUp.cue)
  return new Set(cues)
}

/** Layers for a cue that just started sounding: the target's, or every track for a passing cue */
export function layersFor(target: MusicTarget | null, cue: unknown): number[] {
  return target && target.cue === cue ? target.muted : []
}

/** The `nth` note (1-based) of a climbing stinger; past the top it holds the top note */
export function nthNote(stinger: GameStinger, nth: number): number {
  const { notes } = stinger
  return notes[Math.min(Math.max(nth, 1), notes.length) - 1]
}

/** A cascade's notes: one per reaction, a combo of `sets` runs up the scale from it (3 notes at most) */
export function cascadeNotes(stinger: GameStinger, reaction: number, sets = 1): number[] {
  const count = Math.min(Math.max(sets, 1), 3)
  return Array.from({ length: count }, (_, i) => nthNote(stinger, reaction + i))
}

function sameTracks(a: number[], b: number[]) {
  const set = new Set(a)
  return a.length === b.length && b.every((t) => set.has(t))
}
