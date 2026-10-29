/**
 * What the Game screen shows of a conductor: plain text rows for its state,
 * the DJ's parts in the section playing, and the buttons a song's game
 * settings offer. Pure, so the view stays a thin shell.
 */
import { PLAY_MOOD, type GameMusic } from '../../domain/gameMusic'
import type { ConductorSnapshot } from '../../headless/GameConductor'
import type { DjMove } from '../../player/game/dj'

export interface ReadoutRow {
  label: string
  value: string
}

export type PartState = 'in' | 'out' | 'cut'

export interface PartRow {
  part: string
  tracks: number[]
  state: PartState
}

/** The stingers the conductor plays itself, with notes it picks: not offered as buttons */
const CONDUCTED_STINGERS = ['cascade', 'keys', 'levelUp']

export function moveText(move: DjMove | null): string {
  if (!move) return '—'
  switch (move.kind) {
    case 'hold': return 'hold'
    case 'in': return `+ ${move.part}`
    case 'out': return `− ${move.part}`
    case 'swap': return `${move.out} → ${move.in}`
    case 'cut': return `cut ${move.part}`
  }
}

const isMove = (a: unknown): a is DjMove =>
  typeof a === 'object' && a !== null && ['hold', 'in', 'out', 'swap', 'cut'].includes((a as DjMove).kind)

/** A conductor's log call as one line: numbers rounded, DJ moves in words */
export function logLine(args: unknown[]): string {
  return args.map((a) => (
    typeof a === 'string' ? a
      : typeof a === 'number' ? String(Math.round(a * 10) / 10)
        : isMove(a) ? moveText(a) : JSON.stringify(a)
  )).join(' ')
}

export function readoutRows(snap: ConductorSnapshot): ReadoutRow[] {
  const { visit } = snap
  const stay = visit ? `${visit.bars} / ${visit.stay} bars${snap.due ? (snap.nudged ? ', moving on' : ', due') : ''}` : '—'
  return [
    { label: 'Mood', value: snap.mood || 'silent' },
    { label: 'Section', value: snap.mood === PLAY_MOOD ? snap.section : `${snap.section} (after ${snap.mood})` },
    { label: 'Playing', value: snap.sounding ?? '—' },
    { label: 'Visit', value: stay },
    { label: 'Energy', value: `${snap.target.toFixed(1)} (heat ${snap.energy.heat.toFixed(2)}, rest ${snap.energy.rest.toFixed(2)})` },
    { label: 'Level', value: `${snap.level}, ${Math.round(snap.progress * 100)}%` },
    { label: 'Last move', value: moveText(snap.lastMove) },
  ]
}

/** The DJ's parts in the section playing, and whether each is in, faded out or cut */
export function partRows(snap: ConductorSnapshot, music: GameMusic): PartRow[] {
  const section = music.song.sections.find((s) => s.cue === snap.section)
  return (section?.toys ?? []).map((part) => ({
    part,
    tracks: music.dj.groups[part] ?? [],
    state: snap.visit?.cut.includes(part) ? 'cut' : snap.visit?.out.includes(part) ? 'out' : 'in',
  }))
}

/** What the settings let the screen play: moods (play first), stingers by name, drops */
export function gameButtons(music: GameMusic): { moods: string[]; stingers: string[]; drops: string[] } {
  return {
    moods: [PLAY_MOOD, ...Object.keys(music.moods)],
    stingers: Object.keys(music.stingers).filter((name) => !CONDUCTED_STINGERS.includes(name)),
    drops: Object.keys(music.drops),
  }
}
