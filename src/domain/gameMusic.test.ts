import { describe, expect, it } from 'vitest'
import { createDefaultDoc } from './factory'
import { cueNamed, instrumentNamed, mapGameCues, mapGameInstruments, renamed, type GameMusic } from './gameMusic'

const game: GameMusic = {
  bar: 16,
  intro: 'a',
  song: {
    start: 'a',
    sections: [{ cue: 'a', energy: 2, bars: 4, next: ['b', 'a'], via: 'a' }, { cue: 'b', energy: 3, bars: 4 }],
    peak: { cue: 'a', from: 0.85 },
  },
  dj: { groups: {}, phraseBars: 4, fadeBars: 2, stays: [4] },
  moods: { menu: { cue: 'a', hit: 'b' } },
  fill: { cue: 'a', minCascade: 3 },
  levelUp: { cue: 'b' },
  fills: [{ cue: 'a', goes: 'up' }],
  drops: {},
  stingers: { s: { instrument: 'Bell', notes: [60], at: 'row', rows: 1 } },
}

describe('game music references', () => {
  it('renames every cue reference to a name, and only those', () => {
    const out = mapGameCues(game, renamed('a', 'c'))
    expect(out.intro).toBe('c')
    expect(out.song.start).toBe('c')
    expect(out.song.peak).toEqual({ cue: 'c', from: 0.85 })
    expect(out.song.sections).toEqual([{ cue: 'c', energy: 2, bars: 4, next: ['b', 'c'], via: 'c' }, { cue: 'b', energy: 3, bars: 4 }])
    expect(out.moods.menu).toEqual({ cue: 'c', hit: 'b' })
    expect([out.fill?.cue, out.levelUp?.cue, out.fills?.[0].cue]).toEqual(['c', 'b', 'c'])
    expect(mapGameCues(game, (c) => c)).toEqual(game)
    expect(mapGameInstruments(game, renamed('Bell', 'Chime')).stingers.s.instrument).toBe('Chime')
  })

  it('finds what a name means: an arranged section before a pattern', () => {
    const doc = createDefaultDoc()
    const sid = doc.sectionIds[0]
    const pid = doc.patternId
    doc.entities.patterns[pid].name = 'x'
    expect(cueNamed(doc, 'x')).toBe(pid)
    doc.entities.sections[sid].name = 'x'
    expect(cueNamed(doc, 'x')).toBe(sid)
    expect(cueNamed(doc, 'nothing')).toBeUndefined()
    const inst = Object.values(doc.entities.instruments)[0]
    expect(instrumentNamed(doc, inst.name)).toBe(inst.id)
  })
})
