/**
 * How much a game's music should give, and which section comes next.
 * The level's progress lifts it slowly, cascades heat it up for a while, a
 * level-up or a chorus that just ended lets it rest, and a little randomness
 * keeps it from playing the same way twice. None of it is strict: the song
 * leans towards the target, its grammar decides what may follow what.
 * Pure: `GameConductor` ticks it every bar and asks at each section's end.
 */

import type { GameSection } from '../../domain/gameMusic'

export type Energy = {
  /** Recent excitement from play (cascades), 0..; fades bar by bar */
  heat: number
  /** Calm after a peak (a level-up, a chorus), 0..1; fades bar by bar */
  rest: number
}

export type EnergyEvent =
  | { kind: 'reaction'; nr: number }
  | { kind: 'levelUp' }
  /** A section this energetic or more just ended */
  | { kind: 'peakEnded' }

export const settled: Energy = { heat: 0, rest: 0 }

/** Per bar: excitement halves in ~4 bars, a rest in ~7 */
const HEAT_FADE = 0.85
const REST_FADE = 0.9
const MAX_HEAT = 1.5
/** Sections at least this energetic are peaks: a rest follows them */
export const PEAK_ENERGY = 4

export function afterBar(energy: Energy): Energy {
  return { heat: energy.heat * HEAT_FADE, rest: energy.rest * REST_FADE }
}

export function onEvent(energy: Energy, event: EnergyEvent): Energy {
  switch (event.kind) {
    case 'reaction':
      // the first reaction is just play; a cascade heats up
      return { ...energy, heat: Math.min(MAX_HEAT, energy.heat + 0.12 * (event.nr - 1)) }
    case 'levelUp':
      // the fill and stinger celebrate; then the music takes a breath
      return { heat: 0, rest: 1 }
    case 'peakEnded':
      return { ...energy, rest: Math.max(energy.rest, 0.7) }
  }
}

/**
 * The energy (1..5) to lean towards: the level's progress (and a little the
 * level) lift it, heat from play pushes it up, rest pulls it down; `noise`
 * (about ±0.3) keeps it alive.
 */
export function targetEnergy(
  energy: Energy,
  progress: number,
  level: number,
  noise: number,
): number {
  const base = 1.3 + 1.7 * progress + 0.12 * Math.min(Math.max(level - 1, 0), 8)
  const target = base + 1.8 * energy.heat - 2.2 * energy.rest + noise
  return Math.min(5, Math.max(1, target))
}

/** The energies a section covers: its parts out (the DJ), up to all in */
export function energyRange(section: GameSection): [number, number] {
  return [section.energy - (section.toys?.length ? 1.5 : 0), section.energy]
}

/**
 * The section to play after `current`: `prefer` when its grammar allows it
 * (heading for the peak), else one it allows whose energy range is nearest
 * the target; not one heard just now; a tiny random tie-break (`random`
 * returns 0..1).
 */
export function chooseSection(
  sections: GameSection[],
  current: GameSection,
  target: number,
  recent: string[],
  random: () => number,
  prefer?: string,
): GameSection {
  const allowed = current.next
    ? sections.filter((s) => current.next!.includes(s.cue))
    : sections.filter((s) => s.cue !== current.cue)
  const preferred = allowed.find((s) => s.cue === prefer)
  if (preferred) return preferred
  const candidates = allowed.length > 0 ? allowed : sections
  const distance = (s: GameSection) => {
    const [low, high] = energyRange(s)
    return target < low ? low - target : target > high ? target - high : 0
  }
  const score = (s: GameSection) =>
    -distance(s) - (recent.includes(s.cue) ? 0.8 : 0) + random() * 0.3
  return candidates
    .map((s) => ({ s, score: score(s) }))
    .reduce((best, c) => (c.score > best.score ? c : best)).s
}

/** A stop on the last beat of this bar: at a phrase's end, now and then, when there's energy to stop */
export function stopDue(
  stops: { everyBars: number; chance: number; minEnergy: number } | undefined,
  barInSection: number,
  energy: number,
  random: () => number,
): boolean {
  if (!stops || barInSection % stops.everyBars !== 0 || energy < stops.minEnergy) return false
  return random() < stops.chance
}
