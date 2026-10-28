import { describe, expect, it } from 'vitest'
import type { GameMusic } from '../domain/gameMusic'
import { completeGame, DEFAULT_DJ, type GameRefs } from './completeGame'

const refs: GameRefs = {
  cues: new Set(['verse', 'chorus', 'menu', 'fill', 'sec_1']),
  instruments: new Set(['Stinger', 'inst_1']),
  linesPerBeat: 4,
}

const complete: GameMusic = {
  bar: 16,
  intro: 'fill',
  song: {
    start: 'verse',
    sections: [
      { cue: 'verse', energy: 2, bars: 4, toys: ['drums'], next: ['chorus'] },
      { cue: 'chorus', energy: 5, bars: 8, via: 'fill', muted: [3], transition: false },
    ],
  },
  dj: { groups: { drums: [1, 2] }, phraseBars: 4, fadeBars: 2, stays: [4, 8] },
  moods: { menu: { cue: 'menu', hit: 'fill' }, danger: { cue: 'sec_1', muted: [1], returns: true } },
  fill: { cue: 'fill', minCascade: 3, minBarsApart: 8, minEnergy: 2 },
  levelUp: { cue: 'fill' },
  fills: [{ cue: 'fill', goes: 'down', minEnergy: 1, maxEnergy: 3 }],
  drops: { penalty: [1, 2] },
  stops: { tracks: [1], everyBars: 4, chance: 0.2, minEnergy: 2 },
  stingers: { unlock: { instrument: 'Stinger', notes: [69], at: 'bar', rows: 2, velocity: 100 } },
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('completeGame', () => {
  it('leaves complete settings as they are', () => {
    expect(completeGame(clone(complete), refs)).toEqual(complete)
  })

  it('is absent when the song has none', () => {
    expect(completeGame(undefined, refs)).toBeUndefined()
    expect(completeGame('x', refs)).toBeUndefined()
  })

  it('gives an empty object its defaults', () => {
    expect(completeGame({}, refs)).toEqual({
      bar: 16, song: { start: '', sections: [] }, dj: DEFAULT_DJ, moods: {}, drops: {}, stingers: {},
    })
    expect(completeGame({}, { ...refs, linesPerBeat: 3 })?.bar).toBe(12)
  })

  it('drops whatever names music or an instrument the song lacks', () => {
    const raw = clone(complete) as any
    raw.intro = 'gone'
    raw.song.start = 'gone'
    raw.song.sections.unshift({ cue: 'gone', energy: 1, bars: 4 })
    raw.song.sections[1].next = ['chorus', 'gone']
    raw.song.sections[1].toys = ['drums', 'strings']
    raw.song.sections[2].via = 'gone'
    raw.moods.gameOver = { cue: 'gone' }
    raw.moods.menu.hit = 'gone'
    raw.moods.play = { cue: 'verse' }
    raw.fill.cue = 'gone'
    raw.levelUp = { cue: 7 }
    raw.stingers.keys = { instrument: 'Piano', notes: [60], at: 'row', rows: 1 }
    raw.fills.push({ cue: 'gone', goes: 'up' }, { cue: 'chorus', goes: 'sideways' })
    const game = completeGame(raw, refs)!
    expect(game.fills).toEqual([{ cue: 'fill', goes: 'down', minEnergy: 1, maxEnergy: 3 }])
    expect(game.intro).toBeUndefined()
    expect(game.song.start).toBe('verse')
    expect(game.song.sections.map((s) => s.cue)).toEqual(['verse', 'chorus'])
    expect(game.song.sections[0]).toMatchObject({ next: ['chorus'], toys: ['drums'] })
    expect(game.song.sections[1].via).toBeUndefined()
    expect(Object.keys(game.moods)).toEqual(['menu', 'danger'])
    expect(game.moods.menu).toEqual({ cue: 'menu' })
    expect(game.fill).toBeUndefined()
    expect(game.levelUp).toBeUndefined()
    expect(Object.keys(game.stingers)).toEqual(['unlock'])
  })

  it('repairs numbers and track #s', () => {
    const raw = clone(complete) as any
    raw.bar = 'x'
    raw.song.sections[0] = { cue: 'verse', energy: 9, bars: 0, muted: [0, 2, 2, 'x', 1.5] }
    raw.dj = { groups: { drums: 'x' }, phraseBars: -1, stays: [] }
    raw.stops.chance = 3
    raw.stingers.unlock = { instrument: 'inst_1', notes: [60, 'x'], at: 'later', velocity: 900 }
    const game = completeGame(raw, refs)!
    expect(game.bar).toBe(16)
    expect(game.song.sections[0]).toEqual({ cue: 'verse', energy: 5, bars: 1, muted: [2] })
    expect(game.dj).toEqual({ groups: { drums: [] }, phraseBars: 1, fadeBars: 2, stays: DEFAULT_DJ.stays })
    expect(game.stops?.chance).toBe(1)
    expect(game.stingers.unlock).toEqual({ instrument: 'inst_1', notes: [60], at: 'row', rows: 1, velocity: 127 })
  })
})
