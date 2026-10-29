import { describe, expect, it } from 'vitest'
import type { DjRules, GameSection as Section } from '../../domain/gameMusic'
import {
  applyMove,
  type DjMove,
  type DjVisit,
  fullness,
  isDue,
  landingMove,
  nextMove,
  startVisit,
  visitLevels,
} from './dj'

const rules: DjRules = {
  groups: { drums: [1, 2], hats: [3], chords: [6, 7], arp: [10] },
  phraseBars: 4,
  fadeBars: 2,
  stays: [4, 6, 8],
}
const chorus: Section = { cue: 'chorus', energy: 5, bars: 8, toys: ['drums', 'hats', 'chords', 'arp'] }
const pre: Section = { cue: 'pre', energy: 3.5, bars: 4, transition: true }

/** Draws from a list, round and round */
const draws = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}
const visit = (over: Partial<DjVisit> = {}): DjVisit => ({
  section: 'chorus', bars: 0, stay: 32, out: [], cut: [], ...over,
})

describe('MusicDj', () => {
  it(`stays a few times the section's length; a transition just its own`, () => {
    expect(startVisit(chorus, rules, 5, draws(0)).stay).toBe(32)
    expect(startVisit(chorus, rules, 5, draws(0.5)).stay).toBe(48)
    expect(startVisit(chorus, rules, 5, draws(0.99)).stay).toBe(64)
    expect(startVisit(pre, rules, 3, draws(0.99)).stay).toBe(4)
  })

  it('starts fuller the more energy there is, never with everything out', () => {
    expect(startVisit(chorus, rules, 5, draws(0)).out).toEqual([])
    const sparse = startVisit(chorus, rules, 1, draws(0))
    expect(sparse.out.length).toBeGreaterThan(0)
    expect(sparse.out.length).toBeLessThan(4)
    // after a build-up it lands with everything in
    expect(startVisit(chorus, rules, 1, draws(0), true).out).toEqual([])
    expect(fullness(chorus, 3.5)).toBe(0)
    expect(fullness(chorus, 4.25)).toBeCloseTo(0.5)
  })

  it('is due when its time is up', () => {
    expect(isDue(visit({ bars: 31 }))).toBe(false)
    expect(isDue(visit({ bars: 32 }))).toBe(true)
  })

  it('brings parts in when the energy asks for more, takes them out when it asks for less', () => {
    const moves = (v: DjVisit, energy: number) => {
      const kinds = new Map<string, number>()
      for (let i = 0; i < 200; i++) {
        const r = (i * 0.618) % 1
        const m = nextMove(v, chorus, energy, draws(r, (r * 7) % 1))
        kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1)
      }
      return kinds
    }
    const thin = moves(visit({ out: ['chords', 'arp', 'hats'] }), 5)
    expect(thin.get('in')!).toBeGreaterThan(thin.get('out') ?? 0)
    const full = moves(visit(), 3.6)
    expect((full.get('out') ?? 0) + (full.get('cut') ?? 0)).toBeGreaterThan(full.get('in') ?? 0)
    // nothing to bring in when it's all in, nothing to take out when one is left
    expect(full.get('in')).toBeUndefined()
    expect(moves(visit({ out: ['hats', 'chords', 'arp'] }), 1).get('out')).toBeUndefined()
  })

  it('fades parts, swaps them, and cuts the drums for one phrase', () => {
    let v = visit()
    const play = (move: DjMove) => (v = applyMove(v, move))
    play({ kind: 'out', part: 'chords' })
    expect(v.out).toEqual(['chords'])
    play({ kind: 'swap', out: 'arp', in: 'chords' })
    expect(v.out).toEqual(['arp'])
    play({ kind: 'cut', part: 'drums' })
    expect(v.cut).toEqual(['drums'])
    expect(Object.fromEntries(visitLevels(v, rules))).toEqual({ 1: 0, 2: 0, 3: 1, 6: 1, 7: 1, 10: 0 })
    // the next phrase brings the drums back, whatever the move
    play({ kind: 'hold' })
    expect(v.cut).toEqual([])
    expect(Object.fromEntries(visitLevels(v, rules))).toEqual({ 1: 1, 2: 1, 3: 1, 6: 1, 7: 1, 10: 0 })
  })

  it('moves another part than the last one when it can', () => {
    const v = applyMove(visit({ out: ['arp', 'chords'] }), { kind: 'in', part: 'arp' })
    expect(v.last).toBe('arp')
    // only the chords are out: bringing one in picks them; taking one out avoids the arp
    for (const r of [0, 0.3, 0.6, 0.9]) {
      const m = nextMove(v, chorus, 2, draws(0.5, r))
      if (m.kind === 'out') expect(m.part).not.toBe('arp')
    }
  })

  it('holds a section without parts to play with', () => {
    expect(nextMove(visit(), pre, 3, draws(0.1))).toEqual({ kind: 'hold' })
  })

  it('lands a fill on more: a cut slams back, else a faded part comes in', () => {
    const cut = visit({ out: ['arp'], cut: ['drums'] })
    expect(applyMove(cut, landingMove(cut, draws(0)))).toMatchObject({ out: ['arp'], cut: [] })
    const thin = visit({ out: ['arp', 'chords'] })
    expect(landingMove(thin, draws(0.9))).toEqual({ kind: 'in', part: 'chords' })
    expect(landingMove(visit(), draws(0))).toEqual({ kind: 'hold' })
  })
})
