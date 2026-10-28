import { el } from '@elemaudio/core'
import { AudioHost, OUTPUT_WARMUP_MS } from '../audio/host'
import { decodeSamplesToVfs } from '../audio/vfsDecode'
import { compileGraph, getInstGain } from '../engine/compile'
import { buildPlaybackData, type PlaybackData } from '../player/playbackData'
import { buildTxSeqData } from '../player/txSeqData'
import {
  listCues, mustWaitForWrap, nodeView, planTransition, resolveCue, resumeRow, rotatePlaybackData, rowsPlayed,
  stepTransition, switchRow, trackLevelValues, type Cue, type CueInfo, type CueStep, type CueTiming, type RunningTransition,
} from '../player/cues'
import { unpackSongBundle } from '../persist/songBundle'
import type { SongFile } from '../persist/serialize'
import { clockRow, createClock, musicalTime, observeRow, sendDelay, setClockRate, type MusicalTime, type SongClock } from '../player/songClock'
import { rowHz } from '../domain/notes'
import { DEFAULT_TEMPO, type Doc, type Id, type Instrument } from '../domain/types'
import type { GameMusic } from '../domain/gameMusic'

export type { CueStep, CueTiming }

export interface NoteTiming {
  /** Heard on the next row / beat / bar (default 'now'), plus `delayRows` more rows. */
  at?: 'now' | 'row' | 'beat' | 'bar'
  delayRows?: number
  /** Held for this many rows (default 1). */
  rows?: number
  velocity?: number
}

export interface SongPlayerOptions {
  /** Share an existing context (e.g. the game engine's) instead of creating one. */
  audioContext?: AudioContext
  /** Where the music goes; defaults to the context's destination. */
  destination?: AudioNode
  /** Output gain, 0..1+. */
  volume?: number
  /** For bars in `position()`; default 4. */
  beatsPerBar?: number
}

/** Where the music is, as heard: the cue, its (fractional) row, beats and bars. */
export interface MusicPosition extends MusicalTime {
  cue: Cue
  rowsPerSecond: number
}

export interface RowEvent {
  /** The cue sounding at this row. */
  cue: Cue
  /** Row within that cue. */
  row: number
}

interface Transition extends RunningTransition {
  cue: Cue
  /** Rows into the song where the switch lands. */
  elapsedAt: number
  /** The stage's upload has reached the node; row events now describe it. */
  landed: boolean
  /** The target is sent; until it lands the node still plays the settle data. */
  finishing: boolean
}

/** How often a fade steps (the mute refs smooth each step over 20 ms). */
const FADE_STEP_MS = 30

/** Seconds a cue switch is scheduled ahead, covering event and upload latency. */
const SWITCH_LEAD_S = 0.1

/**
 * Plays synthor songs without the editor: no React, no stores, no storage.
 * Load a `.synthor` file, start() it from a user gesture, then play cues
 * (sections / patterns) and steer them live — track layers, instrument
 * levels, tempo and stinger notes — all without recompiling the graph.
 */
export class SongPlayer {
  readonly host: AudioHost
  private doc: Doc | null = null
  private samples = new Map<string, ArrayBuffer>()
  private prepared: Promise<void> | null = null
  private dataCache = new Map<string, PlaybackData>()

  private setTxSeq: ((props: Record<string, unknown>) => Promise<unknown>) | null = null
  private txSeqNode: unknown = null
  private session = 0
  private uploadRev = 0
  private uploads: Promise<void> = Promise.resolve()

  private playing = false
  /** Bumped by every play/stop, so a play still warming up can tell it was superseded. */
  private request = 0
  /** The sounding cue; its data starts at its row `offset` when it carries on mid-way. */
  private current: { cue: Cue; data: PlaybackData; offset: number } | null = null
  private transition: Transition | null = null
  /** The sounding cue's timeline: rows into the song and its row when it started, its wraps since. */
  private played = { startElapsed: 0, startRow: 0, loops: 0, lastRow: 0 }
  /** Where each cue was left (its row, and rows into the song), for `resume`. */
  private left = new Map<string, { row: number; elapsed: number }>()
  /** A switch asked for just before the loop wraps, planned once it has. */
  private deferred: { step: CueStep; done: () => void } | null = null
  /** Steps of `queue()` still to come; the head is asked for once the step before sounds. */
  private steps: CueStep[] = []
  private noteTimers = new Set<ReturnType<typeof setTimeout>>()
  private lastRow = 0

  private bpm: number
  private linesPerBeat: number
  private beatsPerBar: number
  private clock: SongClock = createClock(1)
  /** The cue (and its length) the latest row event belongs to. */
  private clockCue: { cue: Cue; length: number } | null = null
  private volume: number
  private muted = new Set<number>()
  private levels = new Map<Id, number>()
  /** Track # levels (0..1) for fades; 1 when absent */
  private trackLevels = new Map<number, number>()
  private fades = new Map<number, { from: number; to: number; start: number; ms: number }>()
  private fadeTimer: ReturnType<typeof setInterval> | null = null

  private rowListeners = new Set<(e: RowEvent) => void>()
  private cueListeners = new Set<(cue: Cue) => void>()

  constructor(options: SongPlayerOptions = {}) {
    this.bpm = DEFAULT_TEMPO.bpm
    this.linesPerBeat = DEFAULT_TEMPO.linesPerBeat
    this.beatsPerBar = options.beatsPerBar ?? 4
    this.volume = options.volume ?? 1
    this.host = new AudioHost({
      // noteOn guards on a loaded doc before live notes ever read it.
      liveContext: () => ({ doc: this.doc!, freePlay: false, selectedInstrumentId: null }),
      audioContext: options.audioContext,
      destination: options.destination,
    })
    this.host.onReady = () => this.attachTxSeq()
  }

  /** Load a `.synthor` zip, `.synthor.json` text bytes, or an already parsed song, at the song's
   *  tempo. Stops playback. */
  async load(source: ArrayBuffer | Uint8Array | SongFile): Promise<void> {
    const bundle = 'doc' in source ? { file: source, samples: new Map<string, ArrayBuffer>() } : unpackSongBundle(source)
    this.stop()
    this.doc = bundle.file.doc
    this.bpm = this.doc.tempo.bpm
    this.linesPerBeat = this.doc.tempo.linesPerBeat
    this.samples = bundle.samples
    this.current = null
    this.levels.clear()
    this.trackLevels.clear()
    this.fades.clear()
    this.dataCache.clear()
    this.prepared = null
    if (this.host.isReady) await this.prepare()
  }

  /** Start audio. Call from a user gesture (autoplay policy); safe to call again. */
  async start(): Promise<void> {
    await this.host.start()
    if (this.doc) await this.prepare()
  }

  /** Play `cue` from its top (default: the whole song, or the open pattern without sections). */
  play(cue?: Cue): Promise<void> {
    this.steps = []
    return this.restart(cue)
  }

  private async restart(cue?: Cue): Promise<void> {
    const doc = this.requireDoc()
    const req = ++this.request
    await this.prepare()
    const target = cue ?? this.current?.cue ?? (doc.sectionIds.length > 0 ? { song: true } : doc.patternId)
    const data = this.dataFor(target)

    // A fresh output stream can swallow the first transient; let it settle.
    while (this.host.outputAgeMs < OUTPUT_WARMUP_MS) await new Promise((r) => setTimeout(r, 50))
    if (req !== this.request) return

    this.session++
    this.transition = null
    this.current = { cue: target, data, offset: 0 }
    this.played = { startElapsed: 0, startRow: 0, loops: 0, lastRow: 0 }
    this.left.clear()
    this.dropDeferred()
    this.lastRow = 0
    this.clock = createClock(this.rowsPerSec)
    this.clockCue = null
    this.playing = true
    this.host.paramRefs.setValue('transport:playing', 1)
    this.applyMutes()
    await this.upload(data, 'play')
    this.emitCue(target)
  }

  /**
   * Move to `cue`; while stopped this is play(cue). See CueTiming. A cue asked
   * for during a hand-over replaces the one not yet sounding, or follows the
   * one taking over. Drops what is left of a `queue()`.
   */
  cue(cue: Cue, timing: CueTiming = 'end'): Promise<void> {
    this.steps = []
    return this.switchTo({ cue, timing })
  }

  /**
   * Play cues one after another: each step is asked for once the step before
   * starts sounding, so its timing counts from that cue's top — e.g. a fill
   * then the stage back: `[{ cue: 'fill', timing: { every: 16 } }, { cue: 'stage', timing: 'end' }]`.
   */
  queue(steps: CueStep[]): Promise<void> {
    const [first, ...rest] = steps
    this.steps = rest
    return first ? this.switchTo(first) : Promise.resolve()
  }

  private switchTo(step: CueStep): Promise<void> {
    const { cue, timing = 'end', resume = false } = step
    this.dropDeferred()
    if (!this.playing || !this.current || timing === 'now') return this.restart(cue)
    const running = this.transition
    if (timing === 'sync' && !running) {
      const data = rotatePlaybackData(this.dataFor(cue), this.current.offset)
      this.current = { cue, data, offset: this.current.offset }
      this.applyMutes()
      this.emitCue(cue)
      return this.upload(data, 'update')
    }
    const margin = Math.ceil(this.rowsPerSec * SWITCH_LEAD_S) + 1
    if (mustWaitForWrap(this.current.data, running, this.lastRow, margin)) {
      return new Promise((done) => { this.deferred = { step, done } })
    }

    if (running && running.cue !== this.current.cue && !(running.stage === 'bridge' && this.lastRow < running.at)) {
      // Its cue already sounds, but the switch away lands before it settled.
      this.settleOn(running)
      this.applyMutes()
      this.emitCue(running.cue)
    }
    const view = nodeView(this.current.data, running, this.lastRow, this.current.offset)
    // Mid hand-over the node's rows aren't the cue's, so 'sync' switches on the next row instead.
    const quantum = timing === 'end' ? view.length : timing === 'sync' ? 1 : timing.every
    const at = switchRow(view, this.lastRow, quantum, margin)

    // where the sounding cue is left, and where `cue` carries on
    const n = view.length
    const leaveRow = (((this.lastRow - view.start) % n) + n) % n + (at - this.lastRow)
    const { startElapsed, startRow, loops } = this.played
    const elapsedAt = startElapsed + rowsPlayed(startRow, loops, leaveRow, n)
    this.left.set(cueKey(this.current.cue), { row: leaveRow % n, elapsed: elapsedAt })
    const data = this.dataFor(cue)
    const back = resume ? this.left.get(cueKey(cue)) : undefined
    const offset = back ? resumeRow(back.row, elapsedAt - back.elapsed, data.totalRows) : 0

    const plan = planTransition(view.data, rotatePlaybackData(data, offset), at, view, offset)
    const transition: Transition = { ...plan, cue, elapsedAt, stage: 'bridge', landed: false, finishing: false }
    this.transition = transition
    return this.upload(plan.bridge, 'update').then(() => { transition.landed = true })
  }

  /** A hand-over's cue sounds: it is the current cue from here. */
  private settleOn(t: Transition): void {
    this.current = { cue: t.cue, data: t.target, offset: t.toOffset }
    this.played = { startElapsed: t.elapsedAt, startRow: t.toOffset, loops: 0, lastRow: t.toOffset }
  }

  private dropDeferred(): void {
    this.deferred?.done()
    this.deferred = null
  }

  /** Stop the sequence; release tails ring out. */
  stop(): void {
    this.request++
    this.steps = []
    for (const timer of this.noteTimers) clearTimeout(timer)
    this.noteTimers.clear()
    if (!this.playing) return
    this.playing = false
    this.transition = null
    this.dropDeferred()
    this.host.paramRefs.setValue('transport:playing', 0)
    this.host.setTxSeqProps({ cmd: { type: 'stop', sessionId: this.session } })
  }

  /** Mute / unmute a Track # (1-based, the same position in every pattern) — for layering. */
  setTrackMuted(trackNumber: number, muted: boolean): void {
    if (muted) this.muted.add(trackNumber)
    else this.muted.delete(trackNumber)
    this.applyMutes()
  }

  /** Replace the muted Track #s. */
  setMutedTracks(trackNumbers: Iterable<number>): void {
    this.muted = new Set(trackNumbers)
    this.applyMutes()
  }

  /**
   * A Track #'s level (0..1, in every pattern), faded over `fadeSeconds` — to
   * build a part up or down by layers. A muted track stays silent.
   */
  setTrackLevel(trackNumber: number, level: number, fadeSeconds = 0): void {
    const from = this.trackLevel(trackNumber)
    if (fadeSeconds <= 0 || from === level) {
      this.fades.delete(trackNumber)
      this.trackLevels.set(trackNumber, level)
      this.applyMutes(new Set([trackNumber]))
      return
    }
    this.fades.set(trackNumber, { from, to: level, start: performance.now(), ms: fadeSeconds * 1000 })
    this.fadeTimer ??= setInterval(() => this.stepFades(), FADE_STEP_MS)
  }

  /** A Track #'s level now (mid-fade too). */
  trackLevel(trackNumber: number): number {
    return this.trackLevels.get(trackNumber) ?? 1
  }

  private stepFades(): void {
    const now = performance.now()
    const stepping = new Set(this.fades.keys())
    for (const [n, f] of this.fades) {
      const t = Math.min(1, (now - f.start) / f.ms)
      this.trackLevels.set(n, f.from + (f.to - f.from) * t)
      if (t >= 1) this.fades.delete(n)
    }
    this.applyMutes(stepping)
    if (this.fades.size === 0 && this.fadeTimer) {
      clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
  }

  /** Scale an instrument (by name or id) against its own gain: 0 silences it, 1 is as mixed. */
  setInstrumentLevel(instrument: string, level: number): void {
    const inst = this.findInstrument(instrument)
    if (!inst) return
    this.levels.set(inst.id, level)
    this.host.paramRefs.setValue(`${inst.id}:gain`, getInstGain(inst) * level)
  }

  setVolume(volume: number): void {
    this.volume = volume
    this.host.paramRefs.setValue('player:volume', volume)
  }

  /** Change the tempo live (e.g. speeding up with the game); the next load resets it to the song's. */
  setTempo(bpm: number, linesPerBeat = this.linesPerBeat): void {
    this.bpm = bpm
    this.linesPerBeat = linesPerBeat
    this.host.paramRefs.setValue('transport:rowHz', this.rowsPerSec)
    this.host.setTxSeqProps({ rowsPerSec: this.rowsPerSec })
    this.clock = setClockRate(this.clock, this.rowsPerSec, this.host.currentTime)
  }

  /**
   * Where the music is as heard at `perfNow` (a `performance.now()` time) — read it every
   * frame for animations in time with the music. Null while stopped or before the first row.
   */
  position(perfNow = performance.now()): MusicPosition | null {
    const at = this.clockCue
    const row = at && this.playing ? clockRow(this.clock, this.host.outputTime(perfNow)) : null
    if (row === null || !at) return null
    const wrapped = ((row % at.length) + at.length) % at.length
    return { cue: at.cue, rowsPerSecond: this.rowsPerSec, ...musicalTime(wrapped, this.linesPerBeat, this.beatsPerBar) }
  }

  /** Seconds, as heard, until the next row / beat / bar starts — to land an animation on it. */
  timeUntil(unit: 'row' | 'beat' | 'bar', perfNow = performance.now()): number | null {
    const pos = this.position(perfNow)
    if (!pos) return null
    const size = unit === 'row' ? 1 : unit === 'beat' ? this.linesPerBeat : this.linesPerBeat * this.beatsPerBar
    return (size - (pos.row % size)) / pos.rowsPerSecond
  }

  /** Play a note on a song instrument over the music (stingers). The instrument needs a track in the song. */
  noteOn(instrument: string, note: number, velocity = 127): void {
    const inst = this.findInstrument(instrument)
    if (inst && this.host.isReady) this.host.live.noteOn(inst.id, note, velocity)
  }

  /**
   * A stinger note in time with the music: heard on the next row / beat / bar
   * (sent ahead by the output latency) and released after `rows`. Played at
   * once while stopped. Pending notes are dropped by stop().
   */
  playNote(instrument: string, note: number, timing: NoteTiming = {}): void {
    const { at = 'now', delayRows = 0, rows = 1, velocity = 127 } = timing
    const rowS = 1 / this.rowsPerSec
    const until = at === 'now' ? 0 : this.timeUntil(at)
    const unitRows = at === 'beat' ? this.linesPerBeat : at === 'bar' ? this.linesPerBeat * this.beatsPerBar : 1
    const latency = Math.max(0, this.host.currentTime - this.host.outputTime())
    const delay = until === null
      ? delayRows * rowS
      : sendDelay(until + delayRows * rowS, at === 'now' ? 0 : latency, at === 'now' ? 0 : unitRows * rowS)
    this.later(delay, () => {
      this.noteOn(instrument, note, velocity)
      this.later(rows * rowS, () => this.noteOff(instrument, note))
    })
  }

  noteOff(instrument: string, note: number): void {
    const inst = this.findInstrument(instrument)
    if (inst && this.host.isReady) this.host.live.noteOff(inst.id, note)
  }

  /** Every voice silent, the sequence stopped. */
  panic(): void {
    this.stop()
    this.host.panic()
  }

  /** Called with the cue and its row as playback advances. Returns an unsubscribe. */
  onRow(listener: (e: RowEvent) => void): () => void {
    this.rowListeners.add(listener)
    return () => this.rowListeners.delete(listener)
  }

  /** Called when a cue starts sounding (after its hand-over, not when requested). */
  onCue(listener: (cue: Cue) => void): () => void {
    this.cueListeners.add(listener)
    return () => this.cueListeners.delete(listener)
  }

  get cues(): CueInfo[] {
    return this.doc ? listCues(this.doc) : []
  }

  /** The loaded song's game settings, if it has them (for a `GameConductor`) */
  get game(): GameMusic | null {
    return this.doc?.game ?? null
  }

  get instruments(): { id: Id; name: string }[] {
    return this.doc ? Object.values(this.doc.entities.instruments).map(({ id, name }) => ({ id, name })) : []
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get currentCue(): Cue | null {
    return this.current?.cue ?? null
  }

  private get rowsPerSec(): number {
    return rowHz(this.bpm, this.linesPerBeat)
  }

  private later(seconds: number, fn: () => void): void {
    if (seconds <= 0) return fn()
    const timer = setTimeout(() => {
      this.noteTimers.delete(timer)
      fn()
    }, seconds * 1000)
    this.noteTimers.add(timer)
  }

  private requireDoc(): Doc {
    if (!this.doc) throw new Error('SongPlayer: no song loaded')
    return this.doc
  }

  private findInstrument(ref: string): Instrument | undefined {
    const instruments = this.doc?.entities.instruments
    if (!instruments) return undefined
    return instruments[ref] ?? Object.values(instruments).find((i) => i.name === ref)
  }

  private dataFor(cue: Cue): PlaybackData {
    const key = cueKey(cue)
    let data = this.dataCache.get(key)
    if (!data) {
      const doc = this.requireDoc()
      const items = resolveCue(doc, cue)
      if (!items) throw new Error(`SongPlayer: unknown cue ${key}`)
      data = buildPlaybackData(doc, items)
      this.dataCache.set(key, data)
    }
    return data
  }

  /** Decode the song's samples and render its graph — once per loaded song, after start(). */
  private prepare(): Promise<void> {
    if (!this.host.isReady) return Promise.reject(new Error('SongPlayer: call start() from a user gesture first'))
    this.prepared ??= this.compile(this.requireDoc())
    return this.prepared
  }

  private async compile(doc: Doc): Promise<void> {
    const host = this.host
    const { loaded, l1Sums, decodedSizes } = await decodeSamplesToVfs(
      host,
      Object.values(doc.entities.samples),
      async (hash) => this.samples.get(hash) ?? null,
    )
    if (doc !== this.doc) return

    host.paramRefs.clear()
    const stereo = compileGraph(doc, {
      rowHz: this.rowsPerSec,
      playing: 0,
      startRow: 0,
      playEpoch: 0,
      vfsLoadedHashes: loaded,
      l1Sums,
      decodedSizes,
      paramRefs: host.paramRefs,
      ccBindings: host.ccBindings,
      txSeq: this.txSeqNode as never,
      // No free-play voices: stingers play through the song's tracker slots.
      liveVoiceInstIds: [],
      ensureSlotInstId: null,
    })
    const volume = el.sm(host.paramRefs.getOrCreate('player:volume', this.volume))
    await host.render({ left: el.mul(stereo.left, volume), right: el.mul(stereo.right, volume) })

    for (const [id, level] of this.levels) {
      const inst = doc.entities.instruments[id]
      if (inst) host.paramRefs.setValue(`${id}:gain`, getInstGain(inst) * level)
    }
    this.applyMutes()
  }

  /** The tracks' gains: mutes and levels (`only`: just these Track #s). */
  private applyMutes(only?: ReadonlySet<number>): void {
    if (!this.doc || !this.host.isReady) return
    const winner = this.current?.data.arrangement[0]?.patternId
    const level = (n: number) => (this.muted.has(n) ? 0 : this.trackLevel(n))
    for (const [key, value] of trackLevelValues(this.doc, level, winner, only)) {
      this.host.paramRefs.setValue(key, value)
    }
  }

  /** Upload data and send play/update — in order, and dropped once a newer session started. */
  private upload(data: PlaybackData, type: 'play' | 'update'): Promise<void> {
    const session = this.session
    this.uploads = this.uploads.then(async () => {
      const setTxSeq = this.setTxSeq
      if (!setTxSeq || session !== this.session || !this.playing) return
      const dataPath = `txseq:${this.uploadRev++}`
      await this.host.updateVfs({ [dataPath]: buildTxSeqData(data) })
      const cmd = { type, sessionId: session, rowsPerSec: this.rowsPerSec, totalRows: data.totalRows, dataPath, ...(type === 'play' ? { startRow: 0 } : {}) }
      try {
        await setTxSeq({ cmd, dataPath })
      } catch (err) {
        // The node isn't mounted when the song has no tracks.
        console.warn('[SongPlayer] txSeq update failed:', err)
      }
      void this.host.pruneVfs()
    })
    return this.uploads
  }

  private attachTxSeq(): void {
    const core = this.host.core
    if (!core) return
    // One stable ref per host: its identity and row clock survive recompiles.
    const [node, setter] = core.createRef('txseq', { key: 'txseq', emitEvery: 4, name: 'txseq' }, [])
    this.txSeqNode = node
    this.setTxSeq = setter as (props: Record<string, unknown>) => Promise<unknown>
    this.host.txSeqSetter = this.setTxSeq
    ;(core as unknown as {
      on: (type: string, fn: (event: { row?: number; sessionId?: number }) => void) => void
    }).on('txseq', (e) => {
      if (this.playing && e.sessionId === this.session && typeof e.row === 'number') this.onNodeRow(e.row)
    })
  }

  /** Advance a running hand-over and report the row in cue terms. */
  private onNodeRow(row: number): void {
    this.lastRow = row
    const t = this.transition
    const current = this.current
    if (!current) return
    if (!t) {
      const n = current.data.totalRows
      this.emitRow(current.cue, (row + current.offset) % n, n)
      this.runDeferred()
      return
    }
    if (t.finishing) {
      const n = t.target.totalRows
      this.emitRow(t.cue, ((row >= t.at ? row - t.at : row) + t.toOffset) % n, n)
      return
    }

    const step = stepTransition(t, t.stage, t.landed, row)
    if (step.send === 'settle') {
      t.stage = 'settle'
      t.landed = false
      // Upload before emitting: a queued step's bridge must follow the settle data.
      void this.upload(t.settle, 'update').then(() => { t.landed = true })
      this.settleOn(t)
      this.applyMutes()
      this.emitCue(t.cue)
    } else if (step.send === 'target') {
      t.finishing = true
      void this.upload(t.target, 'update').then(() => {
        if (this.transition === t) this.transition = null
      })
    }
    if (step.sounding === 'from') this.emitRow(current.cue, step.row, t.fromLength)
    else this.emitRow(t.cue, step.row, t.target.totalRows)
  }

  /** A switch held back at the loop's end goes ahead once the loop has wrapped. */
  private runDeferred(): void {
    const d = this.deferred
    if (!d || !this.current) return
    const margin = Math.ceil(this.rowsPerSec * SWITCH_LEAD_S) + 1
    if (mustWaitForWrap(this.current.data, this.transition, this.lastRow, margin)) return
    this.deferred = null
    void this.switchTo(d.step).then(d.done)
  }

  private emitRow(cue: Cue, row: number, length: number): void {
    if (cue === this.current?.cue) {
      if (row < this.played.lastRow) this.played.loops++
      this.played.lastRow = row
    }
    this.clock = observeRow(this.clock, row, this.host.currentTime)
    this.clockCue = { cue, length }
    for (const l of this.rowListeners) l({ cue, row })
  }

  private emitCue(cue: Cue): void {
    for (const l of this.cueListeners) l(cue)
    const next = this.steps.shift()
    if (next) void this.switchTo(next)
  }
}

const cueKey = (cue: Cue): string => JSON.stringify(cue)
