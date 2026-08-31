/**
 * Phase 0 spike: verifies the Elementary Custom Native Node SDK end to end,
 * against a locally built offline-renderer wasm that includes the `txspike`
 * test node (see docs/NATIVE_SEQUENCER_NODE.md). Proves the three paths the
 * sequencer node needs:
 *   - props → signal (setProperty)
 *   - shared resource → signal (bulk data ingestion)
 *   - node → JS events (playhead feedback)
 * Replaced by the real sequencer-node tests in later phases.
 */
import OfflineRenderer from '@elemaudio/offline-renderer'
import { createNode } from '@elemaudio/core'

describe('txspike native node (SDK spike)', () => {
  it('delivers props, shared resources, and events', async () => {
    const core = new OfflineRenderer()
    const events: Array<{ name?: string; block?: number; value?: number; firstSample?: number }> = []
    // txspike is a spike-only event type; the renderer's event map doesn't know it.
    ;(core as unknown as { on: (type: string, fn: (event: never) => void) => void })
      .on('txspike', (e) => events.push(e))

    await core.initialize({
      numInputChannels: 0,
      numOutputChannels: 2,
      sampleRate: 44100,
      blockSize: 128,
      virtualFileSystem: { 'spike-data': new Float32Array([0.25, 0.5, 0.75, 1.0]) },
    })

    await core.render(createNode('txspike', {
      value: 0.5,
      dataPath: 'spike-data',
      emitEvery: 1,
      name: 'spike-test',
    }, []) as never)

    // Run 16 blocks: the root's 20ms fade-in (≈7 blocks at 44100/128) must
    // settle before the node's output reads at full value.
    const out = [new Float32Array(128), new Float32Array(128)]
    for (let b = 0; b < 16; b++) core.process([], out)

    expect(out[0][0]).toBeCloseTo(0.5, 5)   // prop → signal, post-fade
    expect(out[0][127]).toBeCloseTo(0.5, 5)
    expect(events.length).toBeGreaterThan(0) // node → event
    expect(events[0].name).toBe('spike-test')
    expect(events[0].value).toBe(0.5)        // prop observed inside the node
    expect(events[0].firstSample).toBe(0.25) // shared resource observed inside the node
  })
})
