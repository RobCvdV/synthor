import { describe, expect, it } from 'vitest'
import type { GameMusic } from '../../domain/gameMusic'
import {
  cascadeNotes, fillPlan, layersFor, levelUpPlan, nthNote, planChange, sectionFor, targetFor,
  type GameMusicState,
} from './plans'

const music: GameMusic = {
  bar: 16,
  intro: 'intro',
  song: {
    start: 'verse',
    sections: [
      { cue: 'verse', energy: 2, bars: 8, next: ['pre', 'break'] },
      { cue: 'pre', energy: 3.5, bars: 4, next: ['chorus'] },
      { cue: 'chorus', energy: 5, bars: 8, via: 'riser', next: ['break', 'verse'] },
      { cue: 'break', energy: 1, bars: 4, muted: [1, 2], next: ['verse', 'pre'] },
    ],
  },
  dj: { groups: { drums: [1, 2] }, phraseBars: 4, fadeBars: 2, stays: [4] },
  moods: {
    menu: { cue: 'menu' },
    danger: { cue: 'danger', returns: true },
    lastMove: { cue: 'lastMove', muted: [1], returns: true },
    gameOver: { cue: 'gameover' },
  },
  fill: { cue: 'fill', minCascade: 3, minBarsApart: 8 },
  levelUp: { cue: 'levelup-fill' },
  drops: { penalty: [1, 2, 3, 4] },
  stingers: { cascade: { instrument: 'Bell', notes: [69, 72, 74], at: 'row', rows: 2 } },
}

const playing = (over: Partial<GameMusicState> = {}): GameMusicState => ({
  mood: 'play', level: 1, progress: 0, section: 'verse', ...over,
})
const at = (section: string) => targetFor(music, playing({ section }))!
const mood = (name: string) => targetFor(music, playing({ mood: name }))!
const bar = { every: 16 }

describe('game music plans', () => {
  it('plays the section the song is at, the song start when it names none', () => {
    expect(sectionFor(music, 'pre')?.energy).toBe(3.5)
    expect(sectionFor(music, 'nothing')?.cue).toBe('verse')
    expect(at('break')).toEqual({ mood: 'play', cue: 'break', muted: [1, 2], via: undefined })
    expect(mood('lastMove')).toEqual({ mood: 'lastMove', cue: 'lastMove', muted: [1] })
    expect(targetFor(music, playing({ mood: 'nothing' }))).toBeNull()
    const empty = { ...music, song: { start: '', sections: [] } }
    expect(sectionFor(empty, 'verse')).toBeUndefined()
    expect(targetFor(empty, playing())).toBeNull()
  })

  it('starts the first music right away', () => {
    expect(planChange(music, null, mood('menu'))).toEqual({ kind: 'cues', steps: [{ cue: 'menu', timing: 'now' }] })
  })

  it('runs play in through the intro from a mood that does not return', () => {
    for (const from of ['menu', 'gameOver']) {
      expect(planChange(music, mood(from), at('verse'))).toEqual({
        kind: 'cues',
        steps: [{ cue: 'intro', timing: bar }, { cue: 'verse', timing: 'end' }],
      })
    }
  })

  it('moves to the next section on the bar, entering it its own way', () => {
    expect(planChange(music, at('verse'), at('pre'))).toEqual({ kind: 'cues', steps: [{ cue: 'pre', timing: bar }] })
    expect(planChange(music, at('pre'), at('chorus'))).toEqual({
      kind: 'cues',
      steps: [{ cue: 'riser', timing: bar }, { cue: 'chorus', timing: 'end' }],
    })
  })

  it('moves between moods on the bar; play carries on after a mood that returns', () => {
    expect(planChange(music, at('verse'), mood('danger'))).toEqual({ kind: 'cues', steps: [{ cue: 'danger', timing: bar }] })
    expect(planChange(music, mood('danger'), mood('lastMove'))).toEqual({ kind: 'cues', steps: [{ cue: 'lastMove', timing: bar }] })
    expect(planChange(music, mood('lastMove'), at('verse'))).toEqual({
      kind: 'cues',
      steps: [{ cue: 'verse', timing: bar, resume: true }],
    })
  })

  it('only changes layers within a cue, and nothing when they stay', () => {
    const verse = at('verse')
    expect(planChange(music, verse, { ...verse, muted: [3] })).toEqual({ kind: 'layers', muted: [3] })
    expect(planChange(music, verse, at('verse'))).toBeNull()
  })

  it('plays the fill once for a long cascade, in place of a bar of the section', () => {
    const verse = at('verse')
    expect(fillPlan(music, verse, 2)).toBeNull()
    expect(fillPlan(music, verse, 3)).toEqual({
      kind: 'cues',
      steps: [{ cue: 'fill', timing: bar }, { cue: 'verse', timing: 'end', resume: true }],
    })
    // fills stay an accent: not again within 8 bars
    expect(fillPlan(music, verse, 3, 5)).toBeNull()
    expect(fillPlan(music, verse, 3, 8)).not.toBeNull()
    // the cascade goes on: no second fill; none outside play
    expect(fillPlan(music, verse, 4)).toBeNull()
    expect(fillPlan(music, mood('danger'), 3)).toBeNull()
    expect(fillPlan(music, null, 3)).toBeNull()
  })

  it('plays no fill in a section quieter than the fill asks for', () => {
    const quiet = { ...music, fill: { cue: 'fill', minCascade: 3, minEnergy: 3 } }
    expect(fillPlan(quiet, at('verse'), 3)).toBeNull()
    expect(fillPlan(quiet, at('chorus'), 3)).not.toBeNull()
  })

  it('plays the level-up fill into the next section, or in place of a bar', () => {
    expect(levelUpPlan(music, at('verse'), 'break')).toEqual({
      kind: 'cues',
      steps: [{ cue: 'levelup-fill', timing: bar }, { cue: 'break', timing: 'end' }],
    })
    expect(levelUpPlan(music, at('pre'))).toEqual({
      kind: 'cues',
      steps: [{ cue: 'levelup-fill', timing: bar }, { cue: 'pre', timing: 'end', resume: true }],
    })
    expect(levelUpPlan(music, mood('danger'))).toBeNull()
    expect(levelUpPlan(music, null)).toBeNull()
  })

  it("keeps the layers for the target's cue and plays passing cues in full", () => {
    const target = at('break')
    expect(layersFor(target, 'break')).toEqual([1, 2])
    expect(layersFor(target, 'intro')).toEqual([])
    expect(layersFor(null, 'break')).toEqual([])
  })

  it('climbs a stinger and holds its top note; a combo runs up from the reaction', () => {
    const stinger = music.stingers.cascade
    expect([1, 2, 3, 4, 9].map((n) => nthNote(stinger, n))).toEqual([69, 72, 74, 74, 74])
    expect(cascadeNotes(stinger, 1)).toEqual([69])
    expect(cascadeNotes(stinger, 1, 2)).toEqual([69, 72])
    expect(cascadeNotes(stinger, 2, 5)).toEqual([72, 74, 74])
  })
})
