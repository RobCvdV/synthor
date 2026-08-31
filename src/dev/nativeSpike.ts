/**
 * Phase 0 spike harness — runs the `txspike` custom native node through a
 * standalone WebRenderer. Only works after the locally built wasm (with the
 * txspike node) is patched into @elemaudio/web-renderer.
 *
 * Dev-only, loaded from the browser console:
 *   const { runNativeSpike } = await import('/src/dev/nativeSpike.ts')
 *   const stop = await runNativeSpike()   // 440 Hz tone at 0.125 gain
 *   stop()                                // halt + close the context
 *
 * Proves, in the running app: custom node in the web renderer, props → signal,
 * shared resource → signal, live ref prop updates, and native-node events.
 */
import WebRenderer from '@elemaudio/web-renderer'
import { el, type ElemNode } from '@elemaudio/core'

export interface NativeSpikeHandle {
  stop: () => void
  /** RMS level measured at the renderer output, 0..1. */
  getLevel: () => number
}

export async function runNativeSpike(): Promise<NativeSpikeHandle> {
  const ctx = new AudioContext()
  await ctx.resume()
  const core = new WebRenderer()
  // txspike is a spike-only event type; the renderer's event map doesn't know it.
  ;(core as unknown as { on: (type: string, fn: (event: unknown) => void) => void })
    .on('txspike', (e) => console.log('[spike] event', e))

  const node = await core.initialize(ctx, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })

  await core.updateVirtualFileSystem({ 'spike-data': new Float32Array([0.25, 0.5, 0.75, 1.0]) })

  const [tx, setTx] = core.createRef('txspike', {
    value: 0.125,
    dataPath: 'spike-data',
    emitEvery: 100,
    name: 'spike-web',
  }, []) as unknown as [ElemNode, (props: Record<string, unknown>) => void]

  await core.render(el.mul(tx, el.cycle(440)))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  node.connect(analyser)
  analyser.connect(ctx.destination)

  console.log('[spike] running — 440 Hz at 0.125 (ch0) + 0.25 (ch1)')

  const levelBuf = new Float32Array(analyser.fftSize)
  const getLevel = () => {
    analyser.getFloatTimeDomainData(levelBuf)
    let sum = 0
    for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i]
    return Math.sqrt(sum / levelBuf.length)
  }

  // Live prop update proof: ref → native node setProperty, no recompile.
  setTimeout(() => {
    setTx({ value: 0.5 })
    console.log('[spike] setTx({value: 0.5}) — level should rise')
  }, 2000)

  return {
    getLevel,
    stop: () => {
      node.disconnect()
      void ctx.close()
      console.log('[spike] stopped')
    },
  }
}
