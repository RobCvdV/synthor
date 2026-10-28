import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameMusic } from '../domain/gameMusic'
import type { Cue, CueStep } from '../player/cues'
import { GameConductor, type ConductedPlayer } from './GameConductor'
import type { NoteTiming, RowEvent } from './SongPlayer'

const music: GameMusic = {
  bar: 16,
  intro: 'intro',
  song: {
    start: 'verse',
    sections: [
      { cue: 'verse', energy: 2, bars: 2, toys: ['drums', 'chords'], next: ['pre'] },
      { cue: 'pre', energy: 3.5, bars: 1, transition: true, next: ['chorus'] },
      { cue: 'chorus', energy: 5, bars: 2, toys: ['drums', 'chords'], next: ['verse'] },
    ],
  },
  dj: { groups: { drums: [1, 2], chords: [6] }, phraseBars: 4, fadeBars: 2, stays: [4] },
  moods: { menu: { cue: 'menu' }, danger: { cue: 'danger', returns: true }, gameOver: { cue: 'gameover' } },
  fill: { cue: 'fill', minCascade: 3 },
  levelUp: { cue: 'levelup-fill' },
  drops: { penalty: [1, 2, 3] },
  stingers: {
    cascade: { instrument: 'Bell', notes: [69, 72, 74], at: 'row', rows: 2 },
    unlock: { instrument: 'Bell', notes: [76, 81], at: 'row', rows: 2 },
  },
}

/** A player that records what it's asked, and lets a test play rows and cues */
class FakePlayer implements ConductedPlayer {
  queued: CueStep[][] = []
  muted: number[] = []
  levels = new Map<number, number>()
  notes: { instrument: string; note: number; timing?: NoteTiming }[] = []
  stopped = 0
  private rows = new Set<(e: RowEvent) => void>()
  private cues = new Set<(cue: Cue) => void>()
  private row = 0

  queue(steps: CueStep[]) { this.queued.push(steps); return Promise.resolve() }
  stop() { this.stopped++ }
  setMutedTracks(tracks: Iterable<number>) { this.muted = [...tracks] }
  setTrackLevel(track: number, level: number) { this.levels.set(track, level) }
  trackLevel(track: number) { return this.levels.get(track) ?? 1 }
  playNote(instrument: string, note: number, timing?: NoteTiming) { this.notes.push({ instrument, note, timing }) }
  position() { return { cue: 'x', row: this.row, rowsPerSecond: 8, beat: 0, beatPhase: 0, beatInBar: 0, bar: 0, barPhase: 0 } }
  timeUntil() { return 0.5 }
  onRow(l: (e: RowEvent) => void) { this.rows.add(l); return () => this.rows.delete(l) }
  onCue(l: (cue: Cue) => void) { this.cues.add(l); return () => this.cues.delete(l) }

  /** A cue starts sounding */
  sound(cue: Cue) { this.cues.forEach((l) => l(cue)) }
  /** `n` bars pass (each reaches the row a beat before its end, where the conductor acts) */
  bars(n: number) {
    for (let i = 0; i < n; i++) {
      for (const row of [12, 13]) { this.row = row; this.rows.forEach((l) => l({ cue: 'x', row })) }
    }
  }
  get lastCues() { return this.queued.at(-1)?.map((s) => s.cue) }
}

let player: FakePlayer
let conductor: GameConductor

beforeEach(() => {
  vi.useFakeTimers()
  player = new FakePlayer()
  conductor = new GameConductor(player, music, { random: () => 0 })
})
afterEach(() => {
  conductor.dispose()
  vi.useRealTimers()
})

/** Into play: the menu, then the intro into the first section, sounding */
function play() {
  conductor.setMood('menu')
  conductor.setMood('play')
  player.sound('verse')
}

describe('GameConductor', () => {
  it('is silent until the game sets a mood, then plays it at once', () => {
    expect(conductor.conducting).toBe(false)
    conductor.setMood('menu')
    expect(player.queued).toEqual([[{ cue: 'menu', timing: 'now' }]])
    expect(conductor.conducting).toBe(true)
  })

  it('starts play through the intro into the first section', () => {
    play()
    expect(player.queued[1]).toEqual([{ cue: 'intro', timing: { every: 16 } }, { cue: 'verse', timing: 'end' }])
    expect(conductor.snapshot()).toMatchObject({ mood: 'play', section: 'verse', sounding: 'verse' })
  })

  it('stays on a section past its time until the player does something', () => {
    play()
    player.bars(8) // 4 x 2 bars: due
    expect(conductor.snapshot().due).toBe(true)
    player.bars(3)
    expect(player.lastCues).toEqual(['intro', 'verse'])
    conductor.nudge()
    player.bars(1)
    expect(player.lastCues).toEqual(['pre'])
    // a transition moves straight on when its bars are up
    player.sound('pre')
    player.bars(1)
    expect(player.lastCues).toEqual(['chorus'])
  })

  it('moves on at once on a level-up, through the fill', () => {
    play()
    conductor.levelUp(2)
    expect(player.lastCues).toEqual(['levelup-fill', 'pre'])
    expect(conductor.snapshot()).toMatchObject({ section: 'pre', level: 2, progress: 0 })
  })

  it('plays a climbing note per reaction, and the fill on a long cascade', () => {
    play()
    conductor.reaction(1)
    conductor.reaction(2)
    conductor.reaction(3)
    expect(player.notes.map((n) => n.note)).toEqual([69, 72, 74])
    expect(player.lastCues).toEqual(['fill', 'verse'])
    expect(player.queued.at(-1)![1]).toMatchObject({ resume: true })
  })

  it('plays a fill in the mix it breaks into, and lands it on a part coming back', () => {
    conductor.dispose()
    conductor = new GameConductor(player, music, { random: () => 0.99 })
    play()
    player.bars(1)
    player.sound('verse')
    const out = conductor.snapshot().visit!.out
    expect(out.length).toBeGreaterThan(0)
    const silent = out.flatMap((part) => music.dj.groups[part])
    conductor.reaction(1)
    conductor.reaction(2)
    conductor.reaction(3)
    player.sound('fill')
    for (const track of silent) expect(player.levels.get(track)).toBe(0)
    player.bars(4) // a phrase passes under the fill: its parts wait for the landing
    vi.advanceTimersByTime(1000)
    for (const track of silent) expect(player.levels.get(track)).toBe(0)
    player.sound('verse')
    const { lastMove, visit } = conductor.snapshot()
    expect(lastMove?.kind).toBe('in')
    expect(visit!.out.length).toBe(out.length - 1)
  })

  it('falls into a quieter section with a fill going down, which lands on no more', () => {
    conductor.dispose()
    conductor = new GameConductor(player, { ...music, fills: [{ cue: 'fall', goes: 'down' }] }, { random: () => 0.99 })
    play()
    conductor.levelUp(2) // into pre, then on to the chorus
    player.sound('pre')
    player.bars(1)
    player.sound('chorus')
    conductor.levelUp(3)
    expect(player.lastCues).toEqual(['fall', 'verse'])
    player.sound('fall')
    const { visit } = conductor.snapshot()
    player.sound('verse')
    expect(conductor.snapshot()).toMatchObject({ lastMove: null, visit: { out: visit!.out } })
  })

  it('plays stingers by name, only while the music plays', () => {
    conductor.stinger('unlock')
    expect(player.notes).toEqual([])
    play()
    conductor.stinger('unlock')
    expect(player.notes.map((n) => [n.note, n.timing?.delayRows])).toEqual([[76, 0], [81, 1]])
  })

  it('cuts a drop until the next bar', () => {
    play()
    conductor.drop('penalty')
    expect(player.muted).toEqual([1, 2, 3])
    vi.advanceTimersByTime(500)
    expect(player.muted).toEqual([])
  })

  it('carries play on after a mood that returns, and starts it over after one that does not', () => {
    play()
    conductor.levelUp(2) // now at 'pre'
    conductor.setMood('danger')
    expect(player.lastCues).toEqual(['danger'])
    conductor.setMood('play')
    expect(player.queued.at(-1)).toEqual([{ cue: 'pre', timing: { every: 16 }, resume: true }])
    conductor.setMood('gameOver')
    conductor.setMood('play')
    expect(player.lastCues).toEqual(['intro', 'verse'])
  })

  it("sets a section's parts as the DJ has them when it starts", () => {
    conductor.dispose()
    conductor = new GameConductor(player, music, { random: () => 0.99 })
    play()
    player.bars(1) // the visit starts
    player.sound('verse')
    const { visit } = conductor.snapshot()
    for (const part of visit!.out) {
      for (const track of music.dj.groups[part]) expect(player.levels.get(track)).toBe(0)
    }
  })

  it('stops when switched off and picks the mood up again when on', () => {
    play()
    conductor.setEnabled(false)
    expect(player.stopped).toBe(1)
    expect(conductor.conducting).toBe(false)
    conductor.setEnabled(true)
    expect(player.queued.at(-1)).toEqual([{ cue: 'verse', timing: 'now' }])
  })
})
