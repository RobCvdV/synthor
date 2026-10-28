/**
 * Completes a song's game settings (`doc.game`) the way completeDoc completes the rest: missing
 * fields get their defaults, and parts whose cue or instrument names nothing in the song are
 * dropped (a section, a mood, a stinger…), so a conductor never asks for music the song lacks.
 * Cues and instruments are referenced by id or name, as the player resolves them.
 */
import type { DjRules, GameMood, GameMusic, GameSection, GameStinger } from '../domain/gameMusic'
import { PLAY_MOOD } from '../domain/gameMusic'

type Rec = Record<string, unknown>

/** What the song holds that game settings can name */
export interface GameRefs {
  /** Section and pattern ids and names */
  cues: Set<string>
  /** Instrument ids and names */
  instruments: Set<string>
  linesPerBeat: number
}

export const DEFAULT_DJ: DjRules = { groups: {}, phraseBars: 4, fadeBars: 2, stays: [4, 4, 6, 6, 8] }

const AT: GameStinger['at'][] = ['row', 'beat', 'bar']

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const recOf = (v: unknown): Rec => (isRec(v) ? v : {})
const arrOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const num = (v: unknown, fallback: number) => (isNum(v) ? v : fallback)
const count = (v: unknown, fallback: number) => Math.max(1, Math.round(num(v, fallback)))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Track #s are 1-based */
const tracksOf = (v: unknown) => [...new Set(arrOf(v).filter((t): t is number => Number.isInteger(t) && (t as number) >= 1))]

/** `obj` with the keys whose value is undefined left out */
function defined<T extends Rec>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

function completeSection(raw: Rec, refs: GameRefs, groups: Set<string>): GameSection {
  return defined({
    ...raw,
    cue: raw.cue as string,
    energy: clamp(num(raw.energy, 3), 1, 5),
    bars: count(raw.bars, 4),
    toys: raw.toys === undefined ? undefined : arrOf(raw.toys).filter((t): t is string => typeof t === 'string' && groups.has(t)),
    transition: typeof raw.transition === 'boolean' ? raw.transition : undefined,
    next: raw.next === undefined ? undefined : arrOf(raw.next).filter((c): c is string => typeof c === 'string'),
    via: typeof raw.via === 'string' && refs.cues.has(raw.via) ? raw.via : undefined,
    muted: raw.muted === undefined ? undefined : tracksOf(raw.muted),
  })
}

function completeDj(raw: Rec): DjRules {
  const groups: Record<string, number[]> = {}
  for (const [name, tracks] of Object.entries(recOf(raw.groups))) groups[name] = tracksOf(tracks)
  const stays = arrOf(raw.stays).filter((n): n is number => isNum(n) && n > 0)
  return {
    ...raw,
    groups,
    phraseBars: count(raw.phraseBars, DEFAULT_DJ.phraseBars),
    fadeBars: Math.max(0, num(raw.fadeBars, DEFAULT_DJ.fadeBars)),
    stays: stays.length > 0 ? stays : DEFAULT_DJ.stays,
  }
}

function completeStinger(raw: Rec): GameStinger {
  return defined({
    ...raw,
    instrument: raw.instrument as string,
    notes: arrOf(raw.notes).filter(isNum),
    at: AT.find((at) => at === raw.at) ?? 'row',
    rows: count(raw.rows, 1),
    velocity: isNum(raw.velocity) ? clamp(raw.velocity, 0, 127) : undefined,
  })
}

/** The completed settings, or undefined when there are none */
export function completeGame(raw: unknown, refs: GameRefs): GameMusic | undefined {
  if (!isRec(raw)) return undefined
  const resolves = (cue: unknown): cue is string => typeof cue === 'string' && refs.cues.has(cue)
  const dj = completeDj(recOf(raw.dj))
  const groups = new Set(Object.keys(dj.groups))

  const song = recOf(raw.song)
  const sections = arrOf(song.sections)
    .filter((s): s is Rec => isRec(s) && resolves(s.cue))
    .map((s) => completeSection(s, refs, groups))
  const cues = new Set(sections.map((s) => s.cue))
  for (const s of sections) if (s.next) s.next = s.next.filter((c) => cues.has(c))
  const start = typeof song.start === 'string' && cues.has(song.start) ? song.start : (sections[0]?.cue ?? '')

  const moods: Record<string, GameMood> = {}
  for (const [name, m] of Object.entries(recOf(raw.moods))) {
    if (name === PLAY_MOOD || !isRec(m) || !resolves(m.cue)) continue
    moods[name] = defined({
      ...m,
      cue: m.cue,
      muted: m.muted === undefined ? undefined : tracksOf(m.muted),
      returns: typeof m.returns === 'boolean' ? m.returns : undefined,
    })
  }

  const drops: Record<string, number[]> = {}
  for (const [name, tracks] of Object.entries(recOf(raw.drops))) drops[name] = tracksOf(tracks)

  const stingers: Record<string, GameStinger> = {}
  for (const [name, s] of Object.entries(recOf(raw.stingers))) {
    if (isRec(s) && typeof s.instrument === 'string' && refs.instruments.has(s.instrument)) stingers[name] = completeStinger(s)
  }

  const fill = recOf(raw.fill)
  const levelUp = recOf(raw.levelUp)
  const stops = recOf(raw.stops)
  return defined({
    ...raw,
    bar: count(raw.bar, refs.linesPerBeat * 4),
    intro: resolves(raw.intro) ? raw.intro : undefined,
    song: { ...song, start, sections },
    dj,
    moods,
    fill: resolves(fill.cue)
      ? defined({
        ...fill,
        cue: fill.cue,
        minCascade: count(fill.minCascade, 3),
        minBarsApart: isNum(fill.minBarsApart) ? Math.max(0, fill.minBarsApart) : undefined,
        minEnergy: isNum(fill.minEnergy) ? fill.minEnergy : undefined,
      })
      : undefined,
    levelUp: resolves(levelUp.cue) ? { ...levelUp, cue: levelUp.cue } : undefined,
    drops,
    stops: isRec(raw.stops)
      ? {
        ...stops,
        tracks: tracksOf(stops.tracks),
        everyBars: count(stops.everyBars, 4),
        chance: clamp(num(stops.chance, 0.2), 0, 1),
        minEnergy: num(stops.minEnergy, 0),
      }
      : undefined,
    stingers,
  })
}
