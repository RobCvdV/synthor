import { el } from '@elemaudio/core'
import { AudioHost, OUTPUT_WARMUP_MS } from '../audio/host'
import { decodeSamplesToVfs } from '../audio/vfsDecode'
import { compileGraph, getInstGain } from '../engine/compile'
import { buildPlaybackData, type PlaybackData } from '../player/playbackData'
import { buildTxSeqData } from '../player/txSeqData'
import {
  listCues, nextBoundary, planTransition, resolveCue, stepTransition, trackMuteValues,
  type Cue, type CueInfo, type CueTransition, type TransitionStage,
} from '../player/cues'
import { unpackSongBundle } from '../persist/songBundle'
import type { SongFile } from '../persist/serialize'
import { rowHz } from '../domain/notes'
import { DEFAULT_TEMPO, type Doc, type Id, type Instrument } from '../domain/types'

/**
 * When a cue takes over a playing one:
 *   'now'  — restart on the new cue's top immediately.
 *   'sync' — swap at once, keeping the row position (layered variations of equal length).
 *   'end'  — when the current loop finishes.
 *   { every: n } — on the next n-row boundary (n = rows per bar for bar-quantized changes).
 */
export type CueTiming = 'now' | 'sync' | 'end' | { every: number }

export interface SongPlayerOptions {
  /** Share an existing context (e.g. the game engine's) instead of creating one. */
  audioContext?: AudioContext
  /** Where the music goes; defaults to the context's destination. */
  destination?: AudioNode
  /** Output gain, 0..1+. */
  volume?: number
}

export interface RowEvent {
  /** The cue sounding at this row. */
  cue: Cue
  /** Row within that cue. */
  row: number
}

interface Transition extends CueTransition {
  cue: Cue
  stage: TransitionStage
  /** The stage's upload has reached the node; row events now describe it. */
  landed: boolean
}

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
  private current: { cue: Cue; data: PlaybackData } | null = null
  private transition: Transition | null = null
  private queued: { cue: Cue; timing: CueTiming } | null = null
  private lastRow = 0

  private bpm: number
  private linesPerBeat: number
  private volume: number
  private muted = new Set<number>()
  private levels = new Map<Id, number>()

  private rowListeners = new Set<(e: RowEvent) => void>()
  private cueListeners = new Set<(cue: Cue) => void>()

  constructor(options: SongPlayerOptions = {}) {
    this.bpm = DEFAULT_TEMPO.bpm
    this.linesPerBeat = DEFAULT_TEMPO.linesPerBeat
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
  async play(cue?: Cue): Promise<void> {
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
    this.queued = null
    this.current = { cue: target, data }
    this.lastRow = 0
    this.playing = true
    this.host.paramRefs.setValue('transport:playing', 1)
    this.applyMutes()
    await this.upload(data, 'play')
    this.emitCue(target)
  }

  /** Move to `cue`; while stopped this is play(cue). See CueTiming. */
  cue(cue: Cue, timing: CueTiming = 'end'): Promise<void> {
    if (!this.playing || !this.current || timing === 'now') return this.play(cue)
    const data = this.dataFor(cue)
    if (this.transition) {
      // One hand-over at a time; the latest request follows the running one.
      this.queued = { cue, timing }
      return Promise.resolve()
    }
    if (timing === 'sync') {
      this.current = { cue, data }
      this.applyMutes()
      this.emitCue(cue)
      return this.upload(data, 'update')
    }

    const from = this.current.data
    const quantum = timing === 'end' ? from.totalRows : timing.every
    const margin = Math.ceil(this.rowsPerSec * SWITCH_LEAD_S) + 1
    const plan = planTransition(from, data, nextBoundary(this.lastRow, from.totalRows, quantum, margin))
    const transition: Transition = { ...plan, cue, stage: 'bridge', landed: false }
    this.transition = transition
    return this.upload(plan.bridge, 'update').then(() => { transition.landed = true })
  }

  /** Stop the sequence; release tails ring out. */
  stop(): void {
    this.request++
    if (!this.playing) return
    this.playing = false
    this.transition = null
    this.queued = null
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
  }

  /** Play a note on a song instrument over the music (stingers). The instrument needs a track in the song. */
  noteOn(instrument: string, note: number, velocity = 127): void {
    const inst = this.findInstrument(instrument)
    if (inst && this.host.isReady) this.host.live.noteOn(inst.id, note, velocity)
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
    const key = JSON.stringify(cue)
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
    const { loaded, l1Sums } = await decodeSamplesToVfs(
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

  private applyMutes(): void {
    if (!this.doc || !this.host.isReady) return
    const winner = this.current?.data.arrangement[0]?.patternId
    for (const [key, value] of trackMuteValues(this.doc, (n) => this.muted.has(n), winner)) {
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
      this.emitRow(current.cue, row)
      return
    }

    const step = stepTransition(t, t.stage, t.landed, row)
    if (step.send === 'settle') {
      t.stage = 'settle'
      t.landed = false
      this.current = { cue: t.cue, data: t.target }
      this.applyMutes()
      this.emitCue(t.cue)
      void this.upload(t.settle, 'update').then(() => { t.landed = true })
    } else if (step.send === 'target') {
      this.transition = null
      // Rows now index the target directly, so the next hand-over can plan from them.
      this.lastRow = step.row
      void this.upload(t.target, 'update')
      const next = this.queued
      this.queued = null
      if (next) void this.cue(next.cue, next.timing)
    }
    this.emitRow(step.sounding === 'from' ? current.cue : t.cue, step.row)
  }

  private emitRow(cue: Cue, row: number): void {
    for (const l of this.rowListeners) l({ cue, row })
  }

  private emitCue(cue: Cue): void {
    for (const l of this.cueListeners) l(cue)
  }
}
