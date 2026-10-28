import { PLAY_MOOD, type GameMusic, type GameSection, type GameStinger } from '../domain/gameMusic'
import type { CueStep } from '../player/cues'
import {
  cascadeNotes, fillPlan, layersFor, levelUpPlan, nthNote, planChange, sectionFor, targetFor,
  type GameMusicState, type MusicPlan, type MusicTarget,
} from '../player/game/plans'
import {
  afterBar, chooseSection, onEvent, PEAK_ENERGY, settled, stopDue, targetEnergy, type Energy,
} from '../player/game/energy'
import { applyMove, isDue, nextMove, startVisit, visitLevels, type DjMove, type DjVisit } from '../player/game/dj'
import type { Cue } from '../player/cues'
import type { MusicPosition, NoteTiming, RowEvent } from './SongPlayer'

/** What the conductor needs of a player — a `SongPlayer` (a fake in tests). */
export interface ConductedPlayer {
  queue(steps: CueStep[]): Promise<void>
  stop(): void
  setMutedTracks(trackNumbers: Iterable<number>): void
  setTrackLevel(trackNumber: number, level: number, fadeSeconds?: number): void
  trackLevel(trackNumber: number): number
  playNote(instrument: string, note: number, timing?: NoteTiming): void
  position(perfNow?: number): MusicPosition | null
  timeUntil(unit: 'row' | 'beat' | 'bar', perfNow?: number): number | null
  onRow(listener: (e: RowEvent) => void): () => void
  onCue(listener: (cue: Cue) => void): () => void
}

export interface GameConductorOptions {
  /** 0..1; `Math.random` by default. Never a game's seeded random: drawing from it would change its boards. */
  random?: () => number
  /** Where the conductor reports what it does (sections, DJ moves) */
  log?: (...args: unknown[]) => void
}

/** What the conductor is doing, for a readout */
export interface ConductorSnapshot {
  mood: string
  section: string
  sounding: string | null
  visit: DjVisit | null
  due: boolean
  nudged: boolean
  energy: Energy
  /** The energy the music leans towards now */
  target: number
  level: number
  progress: number
  lastMove: DjMove | null
}

/** A section change (and a DJ move) is asked for this many rows before the bar it lands on */
const SECTION_LEAD_ROWS = 4
/** Sections heard just now, kept from coming straight back */
const RECENT_SECTIONS = 2

/**
 * Conducts a song for a game from the song's game settings (`GameMusic`):
 * the game sets the mood and the level's progress and reports what the
 * player does; the conductor picks the sections by energy, lets a DJ play
 * with each one for a good while (moving on when the player does something,
 * or at once on a level-up), and plays fills, drops and stingers.
 */
export class GameConductor {
  private state: GameMusicState
  private visit: DjVisit | null = null
  /** The player did something since the visit fell due: time to move on */
  private nudged = false
  private recentSections: string[] = []
  private energy: Energy = settled
  /** The section's own nudge to the energy, drawn when it was chosen */
  private sectionNoise = 0
  /** The latest row, so a repeated row event doesn't count a bar twice */
  private lastRow = -1
  private lastMove: DjMove | null = null
  /** What is playing (or handing over to); null when silent */
  private sounding: MusicTarget | null = null
  /** The cue heard now, for its layers */
  private heard: Cue | null = null
  /** Tracks cut until a timer brings them back */
  private dropped: number[] = []
  private lastFillAt = -Infinity
  private enabled = true
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private dropTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: (() => void)[]
  private random: () => number
  private log: (...args: unknown[]) => void

  constructor(private player: ConductedPlayer, private music: GameMusic, options: GameConductorOptions = {}) {
    this.random = options.random ?? Math.random
    this.log = options.log ?? (() => {})
    this.state = { mood: '', level: 1, progress: 0, section: music.song.start }
    this.unsubscribe = [
      player.onRow(({ row }) => this.onRow(row)),
      player.onCue((cue) => this.onCue(cue)),
    ]
  }

  /** Stop listening to the player and drop pending timers. */
  dispose(): void {
    this.unsubscribe.forEach((off) => off())
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  /**
   * `play` (the song's sections) or one of the song's moods. Play entered
   * from a mood that doesn't return starts the song over from its first
   * section, through the intro.
   */
  setMood(mood: string): void {
    const fromPlay = this.state.mood === PLAY_MOOD
    const returns = this.music.moods[this.state.mood]?.returns
    if (mood === PLAY_MOOD && !fromPlay && !returns) this.startSong()
    this.state.mood = mood
    this.update()
  }

  /** The level and how far along it is (0..1) */
  setProgress(level: number, progress: number): void {
    this.state.level = level
    this.state.progress = progress
    this.update()
  }

  /** Silent while off (a game's music setting); on again it picks up the mood */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.update()
  }

  /** A reaction in a cascade (1-based within the turn), collecting `sets` sets */
  reaction(nr: number, sets = 1): void {
    this.energy = onEvent(this.energy, { kind: 'reaction', nr })
    if (nr >= 2) this.nudge()
    const { cascade } = this.music.stingers
    if (cascade) this.playStinger(cascade, cascadeNotes(cascade, nr, sets))
    const now = performance.now()
    const barsSinceFill = (now - this.lastFillAt) / 1000 / this.barSeconds
    const fill = fillPlan(this.music, this.sounding, nr, barsSinceFill)
    if (fill) this.lastFillAt = now
    this.run(fill)
  }

  /** The `index`-th key (0-based) of a run (collected keys) */
  key(index: number): void {
    const { keys } = this.music.stingers
    if (keys) this.playStinger(keys, [nthNote(keys, index + 1)])
  }

  /** A new level: its stinger and a fill into a new section, where the music takes a breath */
  levelUp(level: number): void {
    const { levelUp } = this.music.stingers
    if (levelUp) this.playStinger(levelUp)
    this.energy = onEvent(this.energy, { kind: 'levelUp' })
    this.state.level = level
    this.state.progress = 0
    // another mood keeps its music; the section moves on later, by time and play
    const section = sectionFor(this.music, this.state.section)
    if (this.sounding?.mood !== PLAY_MOOD || !section) return
    this.moveOn(section, (next) => levelUpPlan(this.music, this.sounding, next))
  }

  /** Play a stinger by name (an unlock, an achievement…) */
  stinger(name: string): void {
    const stinger = this.music.stingers[name]
    if (stinger) this.playStinger(stinger)
  }

  /** The player did something that counts: a due section moves on at the next bar */
  nudge(): void {
    if (this.visit && isDue(this.visit)) this.nudged = true
  }

  /**
   * Cut a drop's tracks until the next bar, or the one after when the next
   * is less than `minBars` away: they come back on the downbeat
   */
  drop(name: string, minBars = 0): void {
    const tracks = this.music.drops[name]
    if (tracks && this.sounding) this.dropUntilBar(tracks, minBars * this.barSeconds)
  }

  /** The music is playing and answers the game: effects it covers can stay quiet */
  get conducting(): boolean {
    return this.sounding !== null
  }

  get mood(): string {
    return this.state.mood
  }

  /** Where the music is as heard now, or null when none plays */
  position(): MusicPosition | null {
    return this.sounding ? this.player.position() : null
  }

  snapshot(): ConductorSnapshot {
    const { mood, section, level, progress } = this.state
    return {
      mood, section, level, progress,
      sounding: this.sounding?.cue ?? null,
      visit: this.visit,
      due: this.visit ? isDue(this.visit) : false,
      nudged: this.nudged,
      energy: this.energy,
      target: this.liveEnergy,
      lastMove: this.lastMove,
    }
  }

  /** A new run of play starts the song from its first section, settled */
  private startSong(): void {
    this.state.section = this.music.song.start
    this.visit = null
    this.nudged = false
    this.recentSections = []
    this.energy = settled
    this.sectionNoise = 0
    this.lastMove = null
  }

  private get liveEnergy(): number {
    const { level, progress } = this.state
    return targetEnergy(this.energy, progress, level, this.sectionNoise)
  }

  private get barSeconds(): number {
    const rowsPerSecond = this.player.position()?.rowsPerSecond ?? 8
    return this.music.bar / rowsPerSecond
  }

  /**
   * Every bar, a beat before it ends: the energy settles a little and the
   * visit counts the bar. A due section moves on once the player has done
   * something (a transition at once); otherwise at each phrase's end the DJ
   * makes its move for the next phrase, and now and then the phrase's last
   * beat stops.
   */
  private onRow(row: number): void {
    const repeat = row === this.lastRow
    this.lastRow = row
    const { bar } = this.music
    if (repeat || row % bar !== bar - SECTION_LEAD_ROWS) return
    this.energy = afterBar(this.energy)
    const section = sectionFor(this.music, this.state.section)
    if (this.sounding?.mood !== PLAY_MOOD || !section) return
    const visit = this.visit ?? startVisit(section, this.music.dj, this.liveEnergy, this.random)
    this.visit = { ...visit, bars: visit.bars + 1 }

    if (isDue(this.visit) && (section.transition || this.nudged)) {
      this.moveOn(section)
      return
    }
    if (stopDue(this.music.stops, this.visit.bars, this.liveEnergy, this.random)) {
      this.dropUntilBar(this.music.stops!.tracks, 0)
    }
    if (this.visit.bars % this.music.dj.phraseBars === 0) {
      const move = nextMove(this.visit, section, this.liveEnergy, this.random)
      const before = this.visit
      this.visit = applyMove(before, move)
      this.lastMove = move
      this.log('dj', section.cue, move)
      this.playVisit(before)
    }
  }

  private onCue(cue: Cue): void {
    this.heard = cue
    this.applyMutes()
    // a section starts with the DJ's parts set; anything else plays in full
    this.playVisit()
  }

  /** On to the next section: the one nearest the energy that may follow */
  private moveOn(section: GameSection, plan?: (next: string) => MusicPlan | null): void {
    if (section.energy >= PEAK_ENERGY) this.energy = onEvent(this.energy, { kind: 'peakEnded' })
    this.sectionNoise = (this.random() - 0.5) * 0.6
    const target = this.liveEnergy
    const next = chooseSection(this.music.song.sections, section, target, this.recentSections, this.random)
    this.recentSections = [section.cue, ...this.recentSections].slice(0, RECENT_SECTIONS)
    this.state.section = next.cue
    // after a build-up (a transition) the next section lands full
    this.visit = startVisit(next, this.music.dj, target, this.random, section.transition)
    this.nudged = false
    this.lastMove = null
    this.log('section', next.cue, 'energy', target.toFixed(1), 'for', this.visit.stay, 'bars')
    if (!plan) {
      this.update()
      return
    }
    this.run(plan(next.cue))
    this.sounding = targetFor(this.music, this.state)
  }

  /** Every track the DJ plays with */
  private get djTracks(): number[] {
    return Object.values(this.music.dj.groups).flat()
  }

  /**
   * The visit's parts on the next bar: fading over `dj.fadeBars`, a cut (and
   * its return, `before` was the visit's last phrase) hard on the downbeat.
   * Without `before` they're set at once: a section starting, or anything
   * else (a mood, a fill, the intro) playing with every part in.
   */
  private playVisit(before?: DjVisit): void {
    const { player, visit, sounding } = this
    const inSection = visit && sounding?.mood === PLAY_MOOD && this.heard === sounding.cue
    const levels = inSection ? visitLevels(visit, this.music.dj) : new Map<number, number>()
    const { groups } = this.music.dj
    const hard = new Set([...(visit?.cut ?? []), ...(before?.cut ?? [])].flatMap((part) => groups[part] ?? []))
    const fadeSeconds = this.music.dj.fadeBars * this.barSeconds
    const apply = () => {
      for (const track of this.djTracks) {
        const level = levels.get(track) ?? 1
        if (player.trackLevel(track) === level) continue
        player.setTrackLevel(track, level, before && !hard.has(track) ? fadeSeconds : 0)
      }
    }
    if (!before) return apply()
    this.later((player.timeUntil('bar') ?? 0) * 1000, apply)
  }

  private dropUntilBar(tracks: number[], minSeconds: number): void {
    const barS = this.player.timeUntil('bar')
    if (barS == null) return
    if (this.dropTimer) this.clear(this.dropTimer)
    this.dropped = tracks
    this.applyMutes()
    this.dropTimer = this.later((barS < minSeconds ? barS + this.barSeconds : barS) * 1000, () => {
      this.dropped = []
      this.applyMutes()
    })
  }

  private update(): void {
    if (!this.enabled || !this.state.mood) {
      if (this.sounding) this.player.stop()
      this.sounding = null
      this.heard = null
      return
    }
    const target = targetFor(this.music, this.state)
    if (!target) return
    const plan = planChange(this.music, this.sounding, target)
    if (!plan) return
    this.log('music', this.sounding?.cue ?? 'silent', '→', target.cue)
    this.sounding = target
    this.run(plan)
  }

  private run(plan: MusicPlan | null): void {
    if (!plan) return
    if (plan.kind === 'layers') {
      this.applyMutes()
      return
    }
    this.player.queue(plan.steps).catch((err) => this.log('cue failed', plan.steps, err))
  }

  /** The heard cue's mutes, with the drop on top */
  private applyMutes(): void {
    this.player.setMutedTracks([...layersFor(this.sounding, this.heard), ...this.dropped])
  }

  private playStinger(stinger: GameStinger, notes = stinger.notes): void {
    if (!this.sounding) return
    notes.forEach((note, i) =>
      this.player.playNote(stinger.instrument, note, {
        at: stinger.at,
        delayRows: i,
        rows: stinger.rows,
        velocity: stinger.velocity,
      }),
    )
  }

  private later(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, ms)
    this.timers.add(timer)
    return timer
  }

  private clear(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer)
    this.timers.delete(timer)
  }
}
