/**
 * A song's game settings: how a game conducts it. Sections the game moves
 * between by energy, the parts a DJ plays with while one is on, cues for the
 * game's moods (menu, danger…), fills, drops and stingers. Cues name a
 * section or pattern and stingers an instrument, by id (or name).
 */

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

export interface GameMusic {
  /** Rows per bar: every change lands on the next bar */
  bar: number
  /** Played once when play starts (from a mood that doesn't return), before the first section */
  intro?: string
  song: { start: string; sections: GameSection[] }
  dj: DjRules
  /** The game's moods by name; `play` is the sections */
  moods: Record<string, GameMood>
  /**
   * A cascade this long plays the fill once (in play), at most once every
   * `minBarsApart` bars, so fills stay an accent, and not in a section below
   * `minEnergy` (a quiet one: the stingers carry the cascade). Fills play in
   * the mix they break into and land on a part coming back
   */
  fill?: { cue: string; minCascade: number; minBarsApart?: number; minEnergy?: number }
  /** Played on a level-up, into the next section */
  levelUp?: { cue: string }
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
