/**
 * Plays the open song the way a game would: a `SongPlayer` of its own (the
 * editor's transport stays out of it) conducted by a `GameConductor` from the
 * song's game settings, with buttons standing in for the game's events. One
 * per app: the audio context it makes is kept for the next start.
 */
import { PLAY_MOOD, type GameMusic } from '../../domain/gameMusic'
import { GameConductor, type ConductorSnapshot } from '../../headless/GameConductor'
import type { SongPlayer } from '../../headless/SongPlayer'
import { logLine } from './gameReadout'

const LOG_LINES = 40
/** A cascade's reactions, about as far apart as a game's */
const REACTION_MS = 350

export class GameSimulator {
  private player: SongPlayer | null = null
  private conductor: GameConductor | null = null
  private timers = new Set<ReturnType<typeof setTimeout>>()
  /** The settings it plays, as the player completed them */
  music: GameMusic | null = null
  /** What the conductor and the player said, newest last */
  log: string[] = []

  /**
   * Start over from the top: call from a click (autoplay policy). `song` is
   * the song's `.synthor` bytes; the audio starts while they're read.
   */
  async start(song: Promise<ArrayBuffer>): Promise<void> {
    this.stop()
    const player = this.player ?? (await this.createPlayer())
    const started = player.start()
    const bytes = await song
    await started
    await player.load(bytes)
    if (!player.game) throw new Error('This song has no game settings.')
    this.music = player.game
    this.log = []
    this.conductor = new GameConductor(player, player.game, { log: (...args) => this.note(args) })
    this.conductor.setMood(player.game.moods.menu ? 'menu' : PLAY_MOOD)
  }

  stop(): void {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.conductor?.dispose()
    this.conductor = null
    this.player?.stop()
  }

  get running(): boolean {
    return this.conductor !== null
  }

  snapshot(): ConductorSnapshot | null {
    return this.conductor?.snapshot() ?? null
  }

  setMood(mood: string): void {
    this.conductor?.setMood(mood)
  }

  setProgress(level: number, progress: number): void {
    this.conductor?.setProgress(level, progress)
  }

  /** A cascade of `reactions`, one after another */
  cascade(reactions: number): void {
    for (let nr = 1; nr <= reactions; nr++) this.later((nr - 1) * REACTION_MS, () => this.conductor?.reaction(nr))
  }

  /** The `count` keys a level-up collects, one after another */
  keys(count: number): void {
    for (let i = 0; i < count; i++) this.later(i * REACTION_MS, () => this.conductor?.key(i))
  }

  levelUp(): void {
    const level = (this.snapshot()?.level ?? 1) + 1
    this.conductor?.levelUp(level)
  }

  /** A game event with a stinger (an unlock…): the player did something */
  stinger(name: string): void {
    this.conductor?.stinger(name)
    this.conductor?.nudge()
  }

  /** A game event with a drop (a penalty…), until the next bar but at least half one away */
  drop(name: string): void {
    this.conductor?.drop(name, 0.5)
    this.conductor?.nudge()
  }

  nudge(): void {
    this.conductor?.nudge()
  }

  /** Load the player's code ahead (the screen opened), so a start finds it at hand */
  preload(): void {
    void loadPlayer()
  }

  private async createPlayer(): Promise<SongPlayer> {
    const { SongPlayer } = await loadPlayer()
    const player = new SongPlayer()
    player.onCue((cue) => this.note(['now playing', cue]))
    this.player = player
    return player
  }

  private note(args: unknown[]): void {
    this.log = [...this.log, logLine(args)].slice(-LOG_LINES)
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, ms)
    this.timers.add(timer)
  }
}

// loaded with the Game screen, not with the editor
const loadPlayer = () => import('../../headless/SongPlayer')

let shared: GameSimulator | null = null

/** The app's simulator */
export function gameSimulator(): GameSimulator {
  return (shared ??= new GameSimulator())
}
