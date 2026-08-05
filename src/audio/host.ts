import { el } from '@elemaudio/core'
import WebRenderer from '@elemaudio/web-renderer'
import type { StereoOut } from '../engine/modular'
import { ParamRefRegistry, setActiveParamRefs } from './paramRefs'
import { CcBindings } from './ccBindings'
import { VoicePool, LIVE_VOICE_COUNT } from '../engine/voicePool'
import type { DrumKitInstrument } from '../domain/types'
import { SchedulerNode } from '../player/SchedulerNode'

/**
 * Owns the AudioContext + Elementary WebRenderer and pushes compiled graphs to
 * the AudioWorklet. Stateless beyond the audio plumbing: it just renders
 * whatever node it's handed. The store/engine decide *what* to play.
 */
export class AudioHost {
  private ctx: AudioContext | null = null
  private core: WebRenderer | null = null
  private analyser: AnalyserNode | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private renderBusy = false
  private pendingGraph: StereoOut | null = null

  /** The audio-thread scheduler node. Created on first start(). */
  schedulerNode: SchedulerNode | null = null

  /** Registry of createRef-backed param nodes for zero-recompile value updates. */
  readonly paramRefs = new ParamRefRegistry()

  /** CC# → ref-key mapping so MIDI knob turns update the right refs directly. */
  readonly ccBindings = new CcBindings()

  /** Called when start() creates a fresh AudioContext (not a resume).
   *  useEngine wires this to schedule a compile so voice-pool refs exist
   *  before the first MIDI note-on. */
  onReady: (() => void) | null = null

  /** Called when a VoicePool is first created — triggers recompile so
   *  voice slots appear in the graph for the new instrument. */
  onVoicePoolCreated: (() => void) | null = null

  /** Set by App.tsx before changing doc.patternId during section/song playback.
   *  Tells useEngine to skip the next doc-store-triggered recompile — the
   *  pattern change is purely for UI (which pattern the tracker shows) and the
   *  audio graph already spans the full arrangement. */
  skipNextRecompile = false

  /** Fixed voice pools per instrument (lazily created). */
  readonly voicePools = new Map<string, VoicePool>()

  /** Get (or create) a voice pool for an instrument.
   *  The pool updates per-voice refs directly — no graph recompile needed.
   *  Pass `kit` for drumkit instruments to enable per-slot note routing.
   *  Safe to call from any path (MIDI, keyboard, engine) — `setKit` is a
   *  no-op on already-configured pools, so callers can pass kit late without
   *  worrying about creation order. */
  voicePool(instId: string, maxVoices = LIVE_VOICE_COUNT, kit?: DrumKitInstrument): VoicePool {
    let pool = this.voicePools.get(instId)
    if (!pool) {
      pool = new VoicePool(this.paramRefs, instId, maxVoices)
      this.voicePools.set(instId, pool)
      this.onVoicePoolCreated?.()
    }
    if (kit) pool.setKit(kit)
    return pool
  }

  /** Kill all sounding voices across every instrument — both VoicePool-managed
   *  and the all-instrument live voice slots from compileLiveVoices. */
  panic(): void {
    for (const pool of this.voicePools.values()) pool.panic()
    this.paramRefs.panic()
    this.schedulerNode?.panic()
  }

  /** Precise AudioContext time captured at the moment the graph was rendered
   *  for the current playback session. Set by useEngine. */
  playStartTime = 0
  /** Pattern row at which the current playback session started. */
  playStartRow = 0

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0
  }

  get isReady(): boolean {
    return this.ready
  }

  /** RMS of the current output block, 0..~1. Useful as a master meter. */
  getLevel(): number {
    if (!this.analyser) return 0
    const buf = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.sqrt(sum / buf.length)
  }

  /** Raw time-domain waveform from the analyser (for oscilloscope display). */
  getWaveform(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    const buf = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buf)
    return buf
  }

  /** Must be called from a user gesture (browser autoplay policy).
   *  Safe to call multiple times — subsequent calls return the existing promise. */
  async start(): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume()
      return
    }
    // Reuse an in-flight start to avoid creating duplicate AudioContexts.
    if (this.starting) return this.starting
    this.starting = (async () => {
      this.ctx = new AudioContext()
      this.core = new WebRenderer()
      this.paramRefs.attach(this.core)
      setActiveParamRefs(this.paramRefs)
      this.ccBindings.attach(this.paramRefs)
      // Initialize Elementary with 1 input port (32 channels) for the
      // scheduler worklet's control signals (gate/freq per track).
      const node = await this.core.initialize(this.ctx, {
        numberOfInputs: 1,
        channelCount: 32,
        channelCountMode: 'explicit' as const,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })

      // Create and connect the scheduler AudioWorklet.
      const sch = await SchedulerNode.create(this.ctx)
      sch.connect(node) // scheduler output → Elementary input
      this.schedulerNode = sch

      this.analyser = this.ctx.createAnalyser()
      node.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      await this.ctx.resume()
      this.ready = true
      this.starting = null
      this.onReady?.()
    })()
    return this.starting
  }

  /** Render a stereo pair to the output.  Drops frames when busy to avoid
   *  overwhelming Elementary with concurrent render() calls (which crashes
   *  the WASM worklet with Aborted()). */
  render(stereo: StereoOut): void {
    if (!this.ready || !this.core) return

    // If a render is already in flight, store this graph as pending.  When the
    // current render finishes it will pick up the latest pending graph.  This
    // way rapid MIDI / slider bursts only trigger one extra render, not a
    // cascade of concurrent ones.
    if (this.renderBusy) {
      this.pendingGraph = stereo
      return
    }

    this.renderBusy = true
    this.pendingGraph = null

    const finish = () => {
      this.renderBusy = false
      this.paramRefs.flushPending()
      // Render the next queued graph, even if the current one failed.
      const next = this.pendingGraph
      this.pendingGraph = null
      if (next) this.render(next)
    }

    const doRender = () => {
      try {
        this.core!.render(
          el.mul(stereo.left, el.const({ key: 'ch:l', value: 1 })),
          el.mul(stereo.right, el.const({ key: 'ch:r', value: 1 })),
        ).then(finish).catch((err: unknown) => {
          console.error('Elementary render error:', err)
          if (err && typeof err === 'object') {
            const e = err as Record<string, unknown>
            console.error('  message:', e.message)
            console.error('  node property:', e.property)
            console.error('  node kind:', e.kind)
            console.error('  value:', e.value)
          }
          finish() // don't discard pendingGraph on error
        })
      } catch (syncErr: unknown) {
        console.error('Elementary render sync error:', syncErr)
        finish() // don't discard pendingGraph on sync error
      }
    }

    doRender()
  }

  /**
   * Update Elementary's Virtual File System with new / changed sample data.
   * Keys are content hashes; values are mono Float32Array or stereo [L, R].
   */
  async updateVfs(vfs: Record<string, Float32Array | Float32Array[]>): Promise<void> {
    if (!this.core) return
    try {
      await this.core.updateVirtualFileSystem(vfs)
    } catch (err) {
      console.error('Elementary VFS update error:', err)
    }
  }
}
