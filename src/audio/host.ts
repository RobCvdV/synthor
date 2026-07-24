import { el } from '@elemaudio/core'
import WebRenderer from '@elemaudio/web-renderer'
import type { StereoOut } from '../engine/modular'
import { ParamRefRegistry, setActiveParamRefs } from './paramRefs'
import { CcBindings } from './ccBindings'
import { VoicePool } from '../engine/voicePool'

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

  /** Registry of createRef-backed param nodes for zero-recompile value updates. */
  readonly paramRefs = new ParamRefRegistry()

  /** CC# → ref-key mapping so MIDI knob turns update the right refs directly. */
  readonly ccBindings = new CcBindings()

  /** Called when start() creates a fresh AudioContext (not a resume).
   *  useEngine wires this to schedule a compile so voice-pool refs exist
   *  before the first MIDI note-on. */
  onReady: (() => void) | null = null

  /** Fixed voice pools per instrument (lazily created). */
  readonly voicePools = new Map<string, VoicePool>()

  /** Get (or create) a voice pool for an instrument.
   *  The pool updates per-voice refs directly — no graph recompile needed. */
  voicePool(instId: string, maxVoices = 8): VoicePool {
    let pool = this.voicePools.get(instId)
    if (!pool) {
      pool = new VoicePool(this.paramRefs, instId, maxVoices)
      this.voicePools.set(instId, pool)
    }
    return pool
  }

  /** Kill all sounding voices across every instrument. */
  panic(): void {
    for (const pool of this.voicePools.values()) pool.panic()
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
      const node = await this.core.initialize(this.ctx, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })
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

    this.core.render(
      el.mul(stereo.left, el.const({ key: 'ch:l', value: 1 })),
      el.mul(stereo.right, el.const({ key: 'ch:r', value: 1 })),
    ).then(() => {
      this.renderBusy = false
      this.paramRefs.flushPending()
      // If a newer graph was submitted while we were busy, render it now.
      const next = this.pendingGraph
      this.pendingGraph = null
      if (next) this.render(next)
    }).catch((err: unknown) => {
      this.renderBusy = false
      this.pendingGraph = null
      this.paramRefs.flushPending()
      console.error('Elementary render error:', err)
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>
        console.error('  message:', e.message)
        console.error('  node property:', e.property)
        console.error('  node kind:', e.kind)
        console.error('  value:', e.value)
      }
    })
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
