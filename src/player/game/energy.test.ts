import { describe, expect, it } from 'vitest'
import type { GameSection as Section } from '../../domain/gameMusic'
import {
  afterBar,
  chooseSection,
  energyRange,
  onEvent,
  settled,
  stopDue,
  targetEnergy,
} from './energy'

const sections: Section[] = [
  { cue: 'calm', energy: 1.5, bars: 8, next: ['groove', 'break', 'pre'] },
  { cue: 'groove', energy: 2.5, bars: 16, next: ['pre', 'calm', 'break'] },
  { cue: 'pre', energy: 3.5, bars: 4, next: ['chorus'] },
  { cue: 'chorus', energy: 5, bars: 8, next: ['break', 'calm', 'groove'] },
  { cue: 'break', energy: 1, bars: 4, next: ['calm', 'groove', 'pre'] },
]
const at = (cue: string) => sections.find((s) => s.cue === cue)!
const even = () => 0.5
const next = (from: string, target: number, recent: string[] = []) =>
  chooseSection(sections, at(from), target, recent, even).cue

describe('MusicEnergy', () => {
  it(`starts sparse and rises with the level's progress and the level`, () => {
    expect(targetEnergy(settled, 0, 1, 0)).toBeCloseTo(1.3)
    expect(targetEnergy(settled, 1, 1, 0)).toBeCloseTo(3.0)
    expect(targetEnergy(settled, 0.5, 5, 0)).toBeGreaterThan(targetEnergy(settled, 0.5, 1, 0))
    // never past the scale
    expect(targetEnergy({ heat: 1.5, rest: 0 }, 1, 9, 0.3)).toBe(5)
    expect(targetEnergy({ heat: 0, rest: 1 }, 0, 1, -0.3)).toBe(1)
  })

  it('heats up with a cascade, and cools down bar by bar', () => {
    let e = onEvent(settled, { kind: 'reaction', nr: 1 })
    expect(e.heat).toBe(0); // one set is just play
    for (const nr of [2, 3, 4]) e = onEvent(e, { kind: 'reaction', nr })
    expect(e.heat).toBeCloseTo(0.72)
    expect(targetEnergy(e, 0.5, 1, 0)).toBeGreaterThan(targetEnergy(settled, 0.5, 1, 0) + 1)
    for (let bar = 0; bar < 16; bar++) e = afterBar(e)
    expect(e.heat).toBeLessThan(0.06)
  })

  it('rests after a level-up or a peak, for a while', () => {
    const up = onEvent({ heat: 1, rest: 0 }, { kind: 'levelUp' })
    expect(up).toEqual({ heat: 0, rest: 1 })
    expect(targetEnergy(up, 0.9, 4, 0)).toBe(1)
    let e = onEvent(settled, { kind: 'peakEnded' })
    expect(targetEnergy(e, 0.8, 3, 0)).toBeLessThan(2)
    for (let bar = 0; bar < 8; bar++) e = afterBar(e)
    expect(e.rest).toBeGreaterThan(0.25); // still resting after 8 bars
    for (let bar = 0; bar < 16; bar++) e = afterBar(e)
    expect(e.rest).toBeLessThan(0.1)
  })

  it('chooses the allowed section nearest the target energy', () => {
    expect(next('calm', 1.4)).toBe('break')
    expect(next('calm', 2.6)).toBe('groove')
    expect(next('calm', 4)).toBe('pre')
    // the pre-chorus only leads into the chorus, whatever the energy
    expect(next('pre', 1)).toBe('chorus')
    // after a chorus the grammar offers calmer ground
    expect(next('chorus', 5)).toBe('groove')
  })

  it('covers a range of energies when the DJ plays with its parts', () => {
    const toyed: Section = { cue: 'groove', energy: 2.8, bars: 16, toys: ['drums', 'arp'], next: ['pre', 'calm', 'break'] }
    const [low, high] = energyRange(toyed)
    expect(low).toBeCloseTo(1.3)
    expect(high).toBe(2.8)
    expect(energyRange(at('pre'))).toEqual([3.5, 3.5])
    // a target the toyed section can reach by taking parts out
    const all = sections.map((s) => (s.cue === 'groove' ? toyed : s))
    expect(chooseSection(all, at('calm'), 1.9, ['break'], even).cue).toBe('groove')
  })

  it(`stops a phrase's last beat now and then, when there's energy to stop`, () => {
    const stops = { everyBars: 4, chance: 0.3, minEnergy: 2 }
    expect(stopDue(stops, 4, 3, () => 0.1)).toBe(true)
    expect(stopDue(stops, 4, 3, () => 0.5)).toBe(false)
    expect(stopDue(stops, 3, 3, () => 0.1)).toBe(false)
    expect(stopDue(stops, 8, 1.5, () => 0.1)).toBe(false)
    expect(stopDue(undefined, 4, 3, () => 0)).toBe(false)
  })

  it(`doesn't come straight back to a section heard just now`, () => {
    expect(next('calm', 2.6, ['groove'])).not.toBe('groove')
  })

  it('lets a little randomness pick between near equals', () => {
    // from the break, calm (1.5) and groove (2.5) are as near to 2: the draw decides
    const pick = (draws: number[]) => {
      let n = 0
      return chooseSection(sections, at('break'), 2, [], () => draws[n++]).cue
    }
    expect(pick([1, 0, 0])).toBe('calm')
    expect(pick([0, 1, 0])).toBe('groove')
    // but it never outweighs the energy: pre (3.5) loses even on the best draw
    expect(pick([0, 0, 1])).not.toBe('pre')
  })
})
