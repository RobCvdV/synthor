/**
 * A song's game settings: how a game conducts it. Sections the game moves
 * between by energy, the parts a DJ plays with while one is on, cues for the
 * game's moods (menu, danger…), fills, drops and stingers. Cues name a
 * section or pattern and stingers an instrument, by id (or name).
 */

import type { Doc, Id } from './types'

/** A part of the song the game moves between: a verse, a chorus, a break… */
export interface GameSection {
  /** Section or pattern, by id (or name) */
  cue: string
  /** How much it gives with every part in: 1 (sparse) to 5 (everything) */
  energy: number
  /** Its length in bars: a visit lasts a few times this (`dj.stays`) */
  bars: number
  /** Parts (`dj.groups`) the DJ fades, swaps and cuts while it plays */
  toys?: string[]
  /** Plays its bars once and moves straight on (a pre-chorus) */
  transition?: boolean
  /** The sections (cues) that may follow it; any other when absent */
  next?: string[]
  /** Played once on the way in */
  via?: string
  /** Track #s (1-based) silent while it plays */
  muted?: number[]
}

/** The music for one of the game's moods (anything but `play`, which is the sections) */
export interface GameMood {
  cue: string
  /** Played once at once, cutting off what plays (a game over's blast), before the cue */
  hit?: string
  muted?: number[]
  /** It interrupts play (danger): play carries on where it would have been afterwards */
  returns?: boolean
}

/** A fill for where the music goes: into more (`up`), on as it is (`level`) or into less (`down`) */
export interface GameFill {
  cue: string
  goes: 'up' | 'level' | 'down'
  /** It fits a section (the one it breaks into) of at least / below this energy */
  minEnergy?: number
  maxEnergy?: number
}

export interface GameStinger {
  /** Instrument, by id (or name) */
  instrument: string
  /** Played one after another, one row apart */
  notes: number[]
  at: 'row' | 'beat' | 'bar'
  /** Rows each note is held */
  rows: number
  velocity?: number
}

export interface DjRules {
  /** Parts the DJ plays with, by name: their Track #s (1-based) */
  groups: Record<string, number[]>
  /** Bars per phrase: the DJ makes one move per phrase */
  phraseBars: number
  /** Bars a part takes to fade in or out */
  fadeBars: number
  /** How many times its own length a visit lasts, drawn at random from these */
  stays: number[]
}

/** The DJ's timings when a song names none */
export const DEFAULT_DJ_RULES: DjRules = { groups: {}, phraseBars: 4, fadeBars: 2, stays: [4, 4, 6, 6, 8] }

export interface GameMusic {
  /** Rows per bar: every change lands on the next bar */
  bar: number
  /** Played once when play starts (from a mood that doesn't return), before the first section */
  intro?: string
  song: {
    start: string
    sections: GameSection[]
    /**
     * From `from` of a level's progress the song heads for `cue` (the way into
     * its peak, a pre-chorus), once per level, so the peak lands around the
     * level-up. A level-up never cuts a peak short: it celebrates in it
     */
    peak?: { cue: string; from: number }
  }
  dj: DjRules
  /** The game's moods by name; `play` is the sections */
  moods: Record<string, GameMood>
  /**
   * A cascade this long plays a fill once (in play), at most once every
   * `minBarsApart` bars, so fills stay an accent: a `level` one from `fills`
   * that fits the section, else `cue`, but not in a section below `minEnergy`
   * (a quiet one: the stingers carry the cascade). Fills play in the mix they
   * break into and, unless they go down, land on a part coming back
   */
  fill?: { cue: string; minCascade: number; minBarsApart?: number; minEnergy?: number }
  /** Played on a level-up, into the next section: a fill from `fills` going there, else `cue` */
  levelUp?: { cue: string }
  /** Fills picked by where the music goes and the energy of the section they break into */
  fills?: GameFill[]
  /** Track #s a game cuts until the next bar, by name (a penalty, a move in danger…) */
  drops: Record<string, number[]>
  /** Now and then, tracks stop for the last beat of a phrase (every `everyBars`) */
  stops?: { tracks: number[]; everyBars: number; chance: number; minEnergy: number }
  /**
   * Stingers by name. The conductor plays `cascade` (a note per reaction,
   * climbing), `keys` (a note per key) and `levelUp` itself; a game plays
   * any by name
   */
  stingers: Record<string, GameStinger>
}

/** The mood that is the song's sections */
export const PLAY_MOOD = 'play'

/** The settings with every cue reference rewritten by `map` (a section or pattern renamed) */
export function mapGameCues(game: GameMusic, map: (cue: string) => string): GameMusic {
  const moods: Record<string, GameMood> = {}
  for (const [name, mood] of Object.entries(game.moods)) {
    moods[name] = { ...mood, cue: map(mood.cue), ...(mood.hit !== undefined ? { hit: map(mood.hit) } : {}) }
  }
  return {
    ...game,
    ...(game.intro !== undefined ? { intro: map(game.intro) } : {}),
    song: {
      ...game.song,
      start: map(game.song.start),
      ...(game.song.peak ? { peak: { ...game.song.peak, cue: map(game.song.peak.cue) } } : {}),
      sections: game.song.sections.map((s) => ({
        ...s,
        cue: map(s.cue),
        ...(s.next ? { next: s.next.map(map) } : {}),
        ...(s.via !== undefined ? { via: map(s.via) } : {}),
      })),
    },
    moods,
    ...(game.fill ? { fill: { ...game.fill, cue: map(game.fill.cue) } } : {}),
    ...(game.levelUp ? { levelUp: { ...game.levelUp, cue: map(game.levelUp.cue) } } : {}),
    ...(game.fills ? { fills: game.fills.map((f) => ({ ...f, cue: map(f.cue) })) } : {}),
  }
}

/** The settings with every stinger's instrument rewritten by `map` (an instrument renamed) */
export function mapGameInstruments(game: GameMusic, map: (instrument: string) => string): GameMusic {
  const stingers: Record<string, GameStinger> = {}
  for (const [name, s] of Object.entries(game.stingers)) stingers[name] = { ...s, instrument: map(s.instrument) }
  return { ...game, stingers }
}

/** A rename for `mapGame…`: `from` becomes `to`, anything else stays */
export const renamed = (from: string, to: string) => (ref: string) => (ref === from ? to : ref)

/** What a cue's name means, as the player finds it: the first arranged section by that name, else a pattern */
export function cueNamed(doc: Doc, name: string): Id | undefined {
  return doc.sectionIds.find((id) => doc.entities.sections[id]?.name === name)
    ?? Object.values(doc.entities.patterns).find((p) => p.name === name)?.id
}

/** What an instrument's name means: the first instrument by that name */
export function instrumentNamed(doc: Doc, name: string): Id | undefined {
  return Object.values(doc.entities.instruments).find((i) => i.name === name)?.id
}
