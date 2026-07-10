import { el, type NodeRepr_t } from '@elemaudio/core'
import WebRenderer from '@elemaudio/web-renderer'

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

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume()
      return
    }
    this.ctx = new AudioContext()
    this.core = new WebRenderer()
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
  }

  /** Render one mono node to both channels. No-op until started. */
  render(mono: NodeRepr_t): void {
    if (!this.ready || !this.core) return
    // Duplicate through named channels so reconciliation stays stable.
    void this.core.render(el.mul(mono, el.const({ key: 'ch:l', value: 1 })), el.mul(mono, el.const({ key: 'ch:r', value: 1 })))
  }
}
