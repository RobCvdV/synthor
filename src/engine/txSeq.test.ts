/**
 * Phase 1: txSeq native sequencer node — offline verification (SDK-wasm
 * based, like nativeNodeSpike.test.ts). Deterministic tempo:
 * rowsPerSec = sampleRate / blockSize → exactly one row per block.
 *
 * The root's ~20ms fade-in scales output for the first ~7 blocks, so value
 * assertions run on blocks 8+ where the fade has settled.
 */
import OfflineRenderer from '@elemaudio/offline-renderer'
import { createNode } from '@elemaudio/core'
import { buildTxSeqData } from '../player/txSeqData'
import type { PlaybackData } from '../player/playbackData'

const SR = 44100
const BLOCK = 128
const ROW_PER_BLOCK = SR / BLOCK

interface TxSeqEvent { name?: string; row?: number; loop?: boolean; sessionId?: number }

/** One regular slot: [gate, freq, vol, …, staccato] — 11 signals, gate high on `gateRows`. */
function seqFixture(totalRows: number, gateRows: number[], staccato = 1): Float32Array {
  const signals = Array.from({ length: 11 }, () => new Array<number>(totalRows).fill(0))
  const [gate, freq, vol, , , , , , , , stac] = signals
  for (const r of gateRows) gate[r] = 1
  freq.fill(440)
  vol.fill(0.5)
  stac.fill(staccato)
  const data: PlaybackData = {
    slots: [{ instId: 'i1', slotIndex: 0, signals, drumGateCount: 0 }],
    totalRows,
    arrangement: [],
  }
  return buildTxSeqData(data)
}

async function makeCore(vfs: Record<string, Float32Array>) {
  const core = new OfflineRenderer()
  const events: TxSeqEvent[] = []
  ;(core as unknown as { on: (type: string, fn: (event: never) => void) => void })
    .on('txseq', (e) => events.push(e))
  await core.initialize({
    numInputChannels: 0,
    numOutputChannels: 2,
    sampleRate: SR,
    blockSize: BLOCK,
    virtualFileSystem: vfs,
  })
  return { core, events }
}

function processN(core: OfflineRenderer, n: number, out: Float32Array[]): void {
  for (let i = 0; i < n; i++) core.process([], out)
}

describe('txseq native node', () => {
  it('plays gate rows, loops, and reports rows via events', async () => {
    const { core, events } = await makeCore({ 'seq-data': seqFixture(4, [0, 2]) })
    await core.render(createNode('txseq', {
      key: 'txseq',
      cmd: { type: 'play', sessionId: 1, rowsPerSec: ROW_PER_BLOCK, startRow: 0, totalRows: 4, dataPath: 'seq-data' },
      dataPath: 'seq-data',
      testOut: 0,
      emitEvery: 1,
      name: 't1',
    }, []) as never)

    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    processN(core, 7, out) // settle the root fade (rows 0..6)

    const gates: number[] = []
    for (let b = 0; b < 5; b++) {
      core.process([], out)
      gates.push(Math.round(out[0][127])) // rows 7,0,1,2,3
    }
    expect(gates).toEqual([0, 1, 0, 1, 0])

    // One more block wraps to row 0 and fires the loop event.
    core.process([], out)
    expect(Math.round(out[0][127])).toBe(1)
    expect(events.filter((e) => e.loop).length).toBe(3) // wraps at blocks 4, 8, 12
    // Events report wrapped rows (mod totalRows).
    expect(events.map((e) => e.row)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0])
    expect(events[0].sessionId).toBe(1)
  })

  it('stop and panic silence the gates', async () => {
    const { core } = await makeCore({ 'seq-data': seqFixture(4, [0, 1, 2, 3]) })
    const play = (sessionId: number) => core.render(createNode('txseq', {
      key: 'txseq',
      cmd: { type: 'play', sessionId, rowsPerSec: ROW_PER_BLOCK, startRow: 0, totalRows: 4, dataPath: 'seq-data' },
      dataPath: 'seq-data',
      testOut: 0,
      emitEvery: 100,
    }, []) as never)

    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    await play(1)
    processN(core, 8, out)
    expect(Math.round(out[0][127])).toBe(1)

    await core.render(createNode('txseq', { key: 'txseq', cmd: { type: 'stop', sessionId: 1 } }, []) as never)
    core.process([], out)
    expect(out[0][127]).toBe(0)

    await play(2)
    processN(core, 8, out)
    expect(Math.round(out[0][127])).toBe(1)

    await core.render(createNode('txseq', { key: 'txseq', cmd: { type: 'panic' } }, []) as never)
    core.process([], out)
    expect(out[0][127]).toBe(0)
  })

  it('truncates the gate by staccato when the block starts mid-row', async () => {
    // Half a row per block, starting at rowFraction 0.5: even blocks start
    // mid-row (truncated to 0), odd blocks start at a row boundary (gate 1).
    // Block-quantized semantics, matching the former JS scheduler.
    const { core } = await makeCore({ 'seq-data': seqFixture(4, [0, 1, 2, 3], 0.5) })
    await core.render(createNode('txseq', {
      key: 'txseq',
      cmd: { type: 'play', sessionId: 1, rowsPerSec: SR / 256, startRow: 0.5, totalRows: 4, dataPath: 'seq-data' },
      dataPath: 'seq-data',
      testOut: 0,
      emitEvery: 100,
    }, []) as never)

    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    processN(core, 8, out) // settle the root fade

    core.process([], out) // block 8 starts at rowFraction 0.5 → truncated
    expect(out[0][127]).toBe(0)
    core.process([], out) // block 9 starts at a row boundary → gate plays
    expect(Math.round(out[0][127])).toBe(1)
  })

  it('applies live tempo changes', async () => {
    const { core, events } = await makeCore({ 'seq-data': seqFixture(4, [0]) })
    await core.render(createNode('txseq', {
      key: 'txseq',
      cmd: { type: 'play', sessionId: 1, rowsPerSec: ROW_PER_BLOCK, startRow: 0, totalRows: 4, dataPath: 'seq-data' },
      dataPath: 'seq-data',
      testOut: 0,
      emitEvery: 1,
    }, []) as never)

    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    processN(core, 8, out)
    expect(events.at(-1)?.row).toBe(3) // block 7 covers row 7 → wrapped 3

    // 2 rows per block: rows jump 0, 2, 0, 2, …
    await core.render(createNode('txseq', { key: 'txseq', rowsPerSec: ROW_PER_BLOCK * 2 }, []) as never)
    core.process([], out)
    core.process([], out)
    expect(events.at(-1)?.row).toBe(2) // block 9 covered rows 2..3
  })

  it('update swaps sequence data without resetting the row', async () => {
    const { core } = await makeCore({
      'seq-a': seqFixture(4, [0]),
      'seq-b': seqFixture(4, [1]),
    })
    await core.render(createNode('txseq', {
      key: 'txseq',
      cmd: { type: 'play', sessionId: 1, rowsPerSec: ROW_PER_BLOCK, startRow: 0, totalRows: 4, dataPath: 'seq-a' },
      dataPath: 'seq-a',
      testOut: 0,
      emitEvery: 100,
    }, []) as never)

    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    processN(core, 12, out) // blocks 0..11; fade settled, row now 11 → wrapped 3
    core.process([], out)
    expect(Math.round(out[0][127])).toBe(1) // row 0 of seq-a

    await core.render(createNode('txseq', {
      key: 'txseq',
      cmd: { type: 'update', sessionId: 1, totalRows: 4 },
      dataPath: 'seq-b',
    }, []) as never)

    core.process([], out)
    expect(Math.round(out[0][127])).toBe(1) // row 1 of seq-b (row kept advancing)
    core.process([], out)
    expect(Math.round(out[0][127])).toBe(0) // row 2 of seq-b
  })
})
