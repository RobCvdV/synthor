/**
 * A DJ for a game's music: plays with a section the way a DJ would. A visit lasts a few
 * times the section's length; phrase by phrase the DJ fades a part in or
 * out, swaps one for another (the chords out, the arp up), cuts the drums
 * for a phrase and slams them back, or lets it ride. The energy the game asks
 * for only leans it fuller or sparser. When the visit's time is up the
 * section is due, but it plays on until the player does something; a
 * level-up moves on at once. Pure: `GameConductor` plays the moves.
 */

import type { DjRules, GameSection } from '../../domain/gameMusic'

export type { DjRules }

export type DjVisit = {
  section: string
  /** Bars played in this visit */
  bars: number
  /** Bars it stays before it's due to move on */
  stay: number
  /** Parts faded out */
  out: string[]
  /** Parts cut for one phrase: they come back hard on the next */
  cut: string[]
  /** The part moved last, so the next move tends to pick another */
  last?: string
}

export type DjMove =
  | { kind: 'hold' }
  | { kind: 'in'; part: string }
  | { kind: 'out'; part: string }
  | { kind: 'swap'; out: string; in: string }
  | { kind: 'cut'; part: string }

/** The part a DJ may cut for a phrase */
const CUTTABLE = 'drums'
/** A section with every part out gives about this much less than with all in */
const SPREAD = 1.5

/** The share of a section's parts (0..1) that suits the energy */
export function fullness(section: GameSection, energy: number): number {
  const low = section.energy - SPREAD
  return Math.min(1, Math.max(0, (energy - low) / SPREAD))
}

const pick = <T>(items: T[], random: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))]

/**
 * A new visit: how long it stays, and which parts start out (fewer the more
 * energy there is, never all of them; none when it lands after a build-up,
 * `full`)
 */
export function startVisit(
  section: GameSection,
  rules: DjRules,
  energy: number,
  random: () => number,
  full = false,
): DjVisit {
  const toys = section.toys ?? []
  const stay = section.transition ? section.bars : section.bars * pick(rules.stays, random)
  const thin = Math.round(toys.length * (1 - fullness(section, energy)) * 0.6)
  const outCount = full ? 0 : Math.min(toys.length - 1, thin)
  const out: string[] = []
  const pool = [...toys]
  for (let i = 0; i < outCount; i++) out.push(...pool.splice(Math.floor(random() * pool.length), 1))
  return { section: section.cue, bars: 0, stay, out, cut: [] }
}

/** The time is up: the section moves on at the player's next move that counts */
export function isDue(visit: DjVisit): boolean {
  return visit.bars >= visit.stay
}

/**
 * The DJ's move for the next phrase: in when there's less than the energy
 * asks for, out (or a drum cut) when there's more, a swap now and then; but
 * mostly it lets the groove ride a while
 */
export function nextMove(
  visit: DjVisit,
  section: GameSection,
  energy: number,
  random: () => number,
): DjMove {
  const toys = section.toys ?? []
  if (toys.length === 0) return { kind: 'hold' }
  const ins = toys.filter((t) => !visit.out.includes(t))
  const outs = visit.out
  const share = ins.length / toys.length
  const want = fullness(section, energy)
  const fresh = (parts: string[]) => {
    const others = parts.filter((p) => p !== visit.last)
    return pick(others.length > 0 ? others : parts, random)
  }

  const weights: [DjMove['kind'], number][] = [
    ['in', outs.length > 0 ? (share < want - 0.1 ? 4 : 1) : 0],
    ['out', ins.length > 1 ? (share > want + 0.1 ? 4 : 1) : 0],
    ['swap', outs.length > 0 && ins.length > 0 ? 2 : 0],
    ['cut', ins.includes(CUTTABLE) && visit.cut.length === 0 ? (share > want ? 1.5 : 0.7) : 0],
    ['hold', 4],
  ]
  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  let roll = random() * total
  const kind = weights.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'hold'
  switch (kind) {
    case 'in':
      return { kind, part: fresh(outs) }
    case 'out':
      return { kind, part: fresh(ins) }
    case 'swap':
      return { kind, out: fresh(ins), in: fresh(outs) }
    case 'cut':
      return { kind, part: CUTTABLE }
    default:
      return { kind: 'hold' }
  }
}

/** The visit after a move: a cut part is back for the phrase after its own */
export function applyMove(visit: DjVisit, move: DjMove): DjVisit {
  const out = new Set(visit.out)
  let last = visit.last
  switch (move.kind) {
    case 'in':
      out.delete(move.part)
      last = move.part
      break
    case 'out':
      out.add(move.part)
      last = move.part
      break
    case 'swap':
      out.add(move.out)
      out.delete(move.in)
      last = move.in
      break
    case 'cut':
      last = move.part
      break
  }
  return { ...visit, out: [...out], cut: move.kind === 'cut' ? [move.part] : [], last }
}

/** Every track's level (0 or 1) in a visit: the parts out or cut are silent */
export function visitLevels(visit: DjVisit, rules: DjRules): Map<number, number> {
  const levels = new Map<number, number>()
  for (const [part, tracks] of Object.entries(rules.groups)) {
    const silent = visit.out.includes(part) || visit.cut.includes(part)
    for (const track of tracks) levels.set(track, silent ? 0 : 1)
  }
  return levels
}
