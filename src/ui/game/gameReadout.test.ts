import { describe, expect, it } from 'vitest'
import type { GameMusic } from '../../domain/gameMusic'
import type { ConductorSnapshot } from '../../headless/GameConductor'
import { gameButtons, logLine, moveText, partRows, readoutRows } from './gameReadout'

const music: GameMusic = {
  bar: 16,
  song: { start: 'verse', sections: [{ cue: 'verse', energy: 2, bars: 4, toys: ['drums', 'chords', 'arp'] }] },
  dj: { groups: { drums: [1, 2], chords: [6, 7], arp: [10] }, phraseBars: 4, fadeBars: 2, stays: [4] },
  moods: { menu: { cue: 'menu' }, danger: { cue: 'danger', returns: true } },
  drops: { penalty: [1, 2] },
  stingers: {
    cascade: { instrument: 'Bell', notes: [69], at: 'row', rows: 1 },
    unlock: { instrument: 'Bell', notes: [76], at: 'row', rows: 1 },
  },
}

const snap: ConductorSnapshot = {
  mood: 'play',
  section: 'verse',
  sounding: 'verse',
  visit: { section: 'verse', bars: 17, stay: 16, out: ['chords'], cut: ['drums'] },
  due: true,
  nudged: false,
  energy: { heat: 0.4, rest: 0.1 },
  target: 2.34,
  level: 3,
  progress: 0.456,
  lastMove: { kind: 'swap', out: 'chords', in: 'arp' },
}

describe('gameReadout', () => {
  it('describes the conductor in plain rows', () => {
    expect(readoutRows(snap)).toEqual([
      { label: 'Mood', value: 'play' },
      { label: 'Section', value: 'verse' },
      { label: 'Playing', value: 'verse' },
      { label: 'Visit', value: '17 / 16 bars, due' },
      { label: 'Energy', value: '2.3 (heat 0.40, rest 0.10)' },
      { label: 'Level', value: '3, 46%' },
      { label: 'Last move', value: 'chords → arp' },
    ])
    const danger = readoutRows({ ...snap, mood: 'danger', nudged: true, visit: null, lastMove: null })
    expect(danger.find((r) => r.label === 'Section')?.value).toBe('verse (after danger)')
    expect(danger.find((r) => r.label === 'Visit')?.value).toBe('—')
    expect(readoutRows({ ...snap, nudged: true }).find((r) => r.label === 'Visit')?.value).toBe('17 / 16 bars, moving on')
  })

  it('names every DJ move', () => {
    expect([
      moveText({ kind: 'hold' }), moveText({ kind: 'in', part: 'arp' }),
      moveText({ kind: 'out', part: 'arp' }), moveText({ kind: 'cut', part: 'drums' }),
    ]).toEqual(['hold', '+ arp', '− arp', 'cut drums'])
  })

  it('writes log calls as lines', () => {
    expect(logLine(['section', 'chorus', 'energy', 2.6789, 'for', 64, 'bars'])).toBe('section chorus energy 2.7 for 64 bars')
    expect(logLine(['dj', 'verse', 'landing', { kind: 'in', part: 'hats' }])).toBe('dj verse landing + hats')
    expect(logLine(['cue failed', [{ cue: 'x' }]])).toBe('cue failed [{"cue":"x"}]')
  })

  it(`shows the section's parts in, faded out or cut`, () => {
    expect(partRows(snap, music)).toEqual([
      { part: 'drums', tracks: [1, 2], state: 'cut' },
      { part: 'chords', tracks: [6, 7], state: 'out' },
      { part: 'arp', tracks: [10], state: 'in' },
    ])
    expect(partRows({ ...snap, section: 'gone' }, music)).toEqual([])
  })

  it('offers the moods, the stingers a game plays by name, and the drops', () => {
    expect(gameButtons(music)).toEqual({ moods: ['play', 'menu', 'danger'], stingers: ['unlock'], drops: ['penalty'] })
  })
})
