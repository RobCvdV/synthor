// TEMP dev-only probes. Deleted after diagnosis.
import WebRenderer from '@elemaudio/web-renderer'
import { el } from '@elemaudio/core'

const DEST_OPTS = {
  numberOfInputs: 4,
  numberOfOutputs: 1,
  outputChannelCount: [2],
  channelCount: 32,
  channelCountMode: 'explicit',
  processorOptions: { numberOfInputChannels: 96 },
} as const

/** Real-shaped data: 11 signals, zeros on effect channels, vol=1 at note rows. */
export async function probeRealShaped(): Promise<Record<string, unknown>> {
  try {
    const host = (globalThis as Record<string, any>).__host
    const ctx = host.ctx as AudioContext
    const sch = new AudioWorkletNode(ctx, 'scheduler-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [32],
    })
    const core = new WebRenderer()
    const node = await core.initialize(ctx, DEST_OPTS)
    const an = ctx.createAnalyser()
    node.connect(an)
    an.connect(ctx.destination)
    sch.connect(node, 0, 0)
    await ctx.resume()
    const rows = 32
    const note = (r: number) => (r % 4 === 0 ? 1 : 0)
    const signals: number[][] = []
    signals[0] = Array.from({ length: rows }, (_, r) => note(r)) // gate
    signals[1] = new Array(rows).fill(440) // freq
    signals[2] = Array.from({ length: rows }, (_, r) => note(r)) // vol
    signals[3] = new Array(rows).fill(0) // portamento
    signals[4] = new Array(rows).fill(0) // volumeSlide
    signals[5] = new Array(rows).fill(0) // panning
    signals[6] = new Array(rows).fill(0) // vibRate
    signals[7] = new Array(rows).fill(0) // vibDepth
    signals[8] = new Array(rows).fill(0) // tremRate
    signals[9] = new Array(rows).fill(0) // tremDepth
    signals[10] = new Array(rows).fill(1) // staccato
    sch.port.postMessage({
      type: 'play',
      sessionId: 1,
      slots: [{ signals, channelOffset: 0, drumGateCount: 0 }],
      totalRows: rows,
      rowsPerSec: 8,
      startRow: 0,
    })
    await core.render(el.in({ channel: 0 }) as never, el.in({ channel: 0 }) as never)
    const buf = new Float32Array(an.fftSize)
    let saw = 0
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      an.getFloatTimeDomainData(buf)
      for (const v of buf) { if (v > 0.5) saw++ }
    }
    node.disconnect()
    an.disconnect()
    sch.disconnect()
    return { saw }
  } catch (e) {
    return { error: String(e) }
  }
}
