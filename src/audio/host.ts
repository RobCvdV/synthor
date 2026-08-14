import { el } from '@elemaudio/core'
import WebRenderer from '@elemaudio/web-renderer'
import type { StereoOut } from '../engine/modular'
import { ParamRefRegistry, setActiveParamRefs } from './paramRefs'
import { CcBindings } from './ccBindings'
import { VoicePool, LIVE_VOICE_COUNT } from '../engine/voicePool'
import type { DrumKitInstrument } from '../domain/types'
import { SchedulerNode } from '../player/SchedulerNode'

/** Master-level HRTF position. Session-only (not persisted in the doc). */
export interface SpatialParams {
  enabled: boolean
  /** Degrees, -180..180. 0 = straight ahead, positive = right. */
  azimuth: number
  /** Degrees, -90..90. Positive = up. */
  elevation: number
  /** Distance from the listener, clamped ≥ 0.1 (inverse model blows up at 0). */
  distance: number
}

/**
 * Owns the AudioContext + Elementary WebRenderer and pushes compiled graphs to
 * the AudioWorklet. Stateless beyond the audio plumbing: it just renders
 * whatever node it's handed. The store/engine decide *what* to play.
 */
export class AudioHost {
  private ctx: AudioContext | null = null
  private core: WebRenderer | null = null
  private analyser: AnalyserNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private panner: PannerNode | null = null
  private spatial: SpatialParams = { enabled: false, azimuth: 0, elevation: 0, distance: 1 }
  private spatialPatched = false
  private ready = false
  private starting: Promise<void> | null = null
  private renderBusy = false
  private pendingGraph: StereoOut | null = null

  /** The audio-thread scheduler nodes. One per 32-channel batch.
   *  Multiple nodes overcome the browser's 32-channel AudioWorkletNode limit. */
  schedulerNodes: SchedulerNode[] = []

  /** Convenience accessor for the first scheduler node (pattern-mode and legacy). */
  get schedulerNode(): SchedulerNode | null {
    return this.schedulerNodes[0] ?? null
  }

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

  /** Decoded AudioBuffers for sample preview, keyed by content hash. */
  private samplePreviewBuffers = new Map<string, AudioBuffer>()

  /** Active preview sources, so a panic/unmount can cut them short. */
  private previewSources = new Set<AudioBufferSourceNode>()

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
    for (const sch of this.schedulerNodes) sch.panic()
  }

  /**
   * One-shot sample preview straight through Web Audio — no Elementary graph.
   * Decodes on first use and caches the AudioBuffer per hash. `playbackRate`
   * 1 = natural rate; pitch with samplePlaybackRate(note).
   */
  async playSamplePreview(hash: string, bytes: ArrayBuffer, playbackRate = 1): Promise<void> {
    await this.start()
    if (!this.ctx) return
    let buffer = this.samplePreviewBuffers.get(hash)
    if (!buffer) {
      try {
        buffer = await this.ctx.decodeAudioData(bytes.slice(0))
      } catch (err) {
        console.error('[host] sample preview decode failed:', err)
        return
      }
      this.samplePreviewBuffers.set(hash, buffer)
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = playbackRate
    src.connect(this.ctx.destination)
    src.onended = () => {
      this.previewSources.delete(src)
      src.disconnect()
    }
    this.previewSources.add(src)
    src.start()
  }

  /** Cut all in-flight sample previews. */
  stopSamplePreviews(): void {
    for (const src of this.previewSources) {
      src.onended = null
      try { src.stop() } catch { /* already stopped */ }
      src.disconnect()
    }
    this.previewSources.clear()
  }

  /**
   * Play raw in-memory PCM via plain Web Audio — no Elementary, no VFS, no
   * decode (the editor already holds decoded channels). Builds an AudioBuffer
   * in the host context; tracked in previewSources so stopSamplePreviews() cuts
   * it. `offsetSeconds` starts playback mid-buffer (clamped to its duration).
   */
  async playPcmPreview(
    data: Float32Array<ArrayBuffer> | Float32Array<ArrayBuffer>[],
    sampleRate: number,
    offsetSeconds = 0,
  ): Promise<void> {
    await this.start()
    if (!this.ctx) return
    const chs = Array.isArray(data) ? data : [data]
    const frames = chs[0]?.length ?? 0
    if (frames === 0) return
    const buffer = this.ctx.createBuffer(chs.length, frames, sampleRate)
    chs.forEach((ch, i) => buffer.copyToChannel(ch, i))

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.ctx.destination)
    src.onended = () => {
      this.previewSources.delete(src)
      src.disconnect()
    }
    this.previewSources.add(src)
    src.start(0, Math.max(0, Math.min(offsetSeconds, buffer.duration)))
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
      // Multiple scheduler nodes to overcome the browser's 32-channel
      // AudioWorkletNode limit.  Each handles up to 32 control channels;
      // Elementary reads from all inputs as one flat channel space.
      const CHANNELS_PER_NODE = 32
      const NUM_SCHEDULER_NODES = 4
      const TOTAL_CONTROL_CHANNELS = CHANNELS_PER_NODE * NUM_SCHEDULER_NODES

      console.log('[host] creating', NUM_SCHEDULER_NODES, 'SchedulerNodes (', TOTAL_CONTROL_CHANNELS, 'total channels)...')
      const schNodes: SchedulerNode[] = []
      for (let i = 0; i < NUM_SCHEDULER_NODES; i++) {
        schNodes.push(await SchedulerNode.create(this.ctx, CHANNELS_PER_NODE))
      }
      this.schedulerNodes = schNodes

      const node = await this.core.initialize(this.ctx, {
        numberOfInputs: NUM_SCHEDULER_NODES,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          numberOfInputChannels: TOTAL_CONTROL_CHANNELS,
        },
      })

      // Route each scheduler to its own Elementary input port.
      for (let i = 0; i < NUM_SCHEDULER_NODES; i++) {
        schNodes[i].connect(node, 0, i)
      }

      this.analyser = this.ctx.createAnalyser()
      this.workletNode = node
      node.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)

      // HRTF panner sits idle until spatial is enabled — then the worklet
      // output is re-routed through it (see applySpatial).
      this.panner = this.ctx.createPanner()
      this.panner.panningModel = 'HRTF'
      this.panner.distanceModel = 'inverse'
      this.panner.refDistance = 1

      await this.ctx.resume()
      this.ready = true
      this.starting = null
      this.applySpatial(this.spatial)
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
      console.log('[host] render complete')
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
          console.error('[host] Elementary render error:', err)
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
        console.error('[host] Elementary render sync error:', syncErr)
        finish() // don't discard pendingGraph on sync error
      }
    }

    doRender()
  }

  /** Current HRTF position — the UI reads this to initialise its controls. */
  get spatialState(): SpatialParams {
    return { ...this.spatial }
  }

  /**
   * Position (and optionally patch in) the master HRTF panner. The worklet's
   * stereo output is treated as a single point source. Safe to call before
   * start(): the state is stored and applied once the context is ready.
   */
  applySpatial(s: SpatialParams): void {
    this.spatial = { ...s }
    if (!this.ready || !this.ctx || !this.panner || !this.analyser || !this.workletNode) return

    const az = (s.azimuth * Math.PI) / 180
    const elv = (s.elevation * Math.PI) / 180
    const d = Math.max(0.1, s.distance)
    this.panner.positionX.value = d * Math.cos(elv) * Math.sin(az)
    this.panner.positionY.value = d * Math.sin(elv)
    this.panner.positionZ.value = d * Math.cos(elv) * Math.cos(az)

    if (s.enabled === this.spatialPatched) return
    this.spatialPatched = s.enabled
    if (s.enabled) {
      // Disconnect the direct path BEFORE patching through the panner,
      // otherwise the dry path leaks.
      this.workletNode.disconnect(this.analyser)
      this.workletNode.connect(this.panner)
      this.panner.connect(this.analyser)
    } else {
      this.workletNode.disconnect(this.panner)
      this.panner.disconnect(this.analyser)
      this.workletNode.connect(this.analyser)
    }
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
