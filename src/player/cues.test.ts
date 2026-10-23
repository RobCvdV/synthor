import { describe, expect, it } from 'vitest'
import OfflineRenderer from '@elemaudio/offline-renderer'
import { createNode } from '@elemaudio/core'
import { buildTxSeqData } from './txSeqData'
import { buildPlaybackData, type PlaybackData } from './playbackData'
import {
  concatPlaybackData, listCues, nextBoundary, planTransition, resolveCue, stepTransition, tilePlaybackData, trackMuteValues,
  type TransitionStage,
} from './cues'
import { newModularInstrument, newTrack } from '../domain/factory'
import type { Doc, Id, Pattern, Track } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { REGULAR_CH } from '../engine/voiceSlotLayout'

function makeDoc(tracks: Track[], patterns: Pattern[], sections: { id: Id; name: string; patternIds: Id[] }[] = []): Doc {
  const inst = newModularInstrument('Lead')
  inst.id = 'inst_lead'
  for (const t of tracks) t.instrumentId = inst.id
  return {
    entities: {
      instruments: { [inst.id]: inst },
      tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
      patterns: Object.fromEntries(patterns.map((p) => [p.id, p])),
      sections: Object.fromEntries(sections.map((s) => [s.id, s])),
      samples: {},
      mixChannels: { [MASTER_CHANNEL_ID]: { id: MASTER_CHANNEL_ID, name: 'Master', kind: 'master', volume: 1, pan: 0, mute: false, solo: false, effects: [] } },
      mixerInstrumentOrder: [inst.id],
    },
    patternId: patterns[0].id,
    sectionIds: sections.map((s) => s.id),
  }
}

/** A pattern whose row r plays note `base + r`, so every row is identifiable by its freq. */
function rampPattern(id: string, length: number, base: number): { pattern: Pattern; track: Track } {
  const track = newTrack('inst_lead', length)
  track.id = `trk_${id}`
  for (let r = 0; r < length; r++) {
    track.cells[r].note = base + r
    track.cells[r].hold = false
  }
  return { pattern: { id, name: id.toUpperCase(), length, trackIds: [track.id] }, track }
}

function rampDoc(lenA: number, lenB: number): Doc {
  const a = rampPattern('a', lenA, 40)
  const b = rampPattern('b', lenB, 80)
  return makeDoc([a.track, b.track], [a.pattern, b.pattern])
}

const freqAt = (data: PlaybackData, row: number) =>
  data.slots[0].signals[REGULAR_CH.freq][((row % data.totalRows) + data.totalRows) % data.totalRows]

/**
 * Plays rows the way txSeq does (reads data modulo its length, keeps its row
 * across updates, wraps by subtracting the length) and drives the hand-over
 * with stepTransition, each upload landing `lag` rows after it was sent.
 */
function simulate(from: PlaybackData, to: PlaybackData, startRow: number, at: number, lag: number, rows: number): number[] {
  const plan = planTransition(from, to, at)
  let data = from
  let stage: TransitionStage = 'bridge'
  let landed = false
  let pending: { data: PlaybackData; inRows: number } | null = { data: plan.bridge, inRows: lag }
  let pos = startRow
  const played: number[] = []
  for (let i = 0; i < rows; i++) {
    if (pending && pending.inRows-- <= 0) { data = pending.data; pending = null; landed = true }
    played.push(freqAt(data, pos))
    const step = stepTransition(plan, stage, landed, pos)
    if (step.send) {
      stage = 'settle'
      landed = false
      pending = { data: step.send === 'settle' ? plan.settle : plan.target, inRows: lag }
    }
    pos += 1
    if (pos >= data.totalRows) pos -= data.totalRows
  }
  return played
}

describe('resolveCue / listCues', () => {
  const a = rampPattern('a', 4, 40)
  const b = rampPattern('b', 8, 60)
  const doc = makeDoc([a.track, b.track], [a.pattern, b.pattern], [
    { id: 'sec_intro', name: 'intro', patternIds: ['a'] },
    { id: 'sec_main', name: 'main', patternIds: ['a', 'b', 'a'] },
  ])

  it('resolves a section by name with cumulative offsets', () => {
    expect(resolveCue(doc, 'main')).toEqual([
      { patternId: 'a', startRow: 0, sectionId: 'sec_main', step: 0 },
      { patternId: 'b', startRow: 4, sectionId: 'sec_main', step: 1 },
      { patternId: 'a', startRow: 12, sectionId: 'sec_main', step: 2 },
    ])
  })

  it('falls back from sections to patterns, by name or id', () => {
    expect(resolveCue(doc, 'B')).toEqual([{ patternId: 'b', startRow: 0 }])
    expect(resolveCue(doc, { pattern: 'a' })).toEqual([{ patternId: 'a', startRow: 0 }])
    expect(resolveCue(doc, 'sec_intro')?.[0].sectionId).toBe('sec_intro')
  })

  it('plays every section for the song and returns null for unknown cues', () => {
    expect(resolveCue(doc, { song: true })).toHaveLength(4)
    expect(resolveCue(doc, 'nope')).toBeNull()
    expect(resolveCue(doc, { section: 'A' })).toBeNull()
  })

  it('lists sections then patterns with their lengths', () => {
    expect(listCues(doc).map((c) => `${c.kind}:${c.name}:${c.rows}`)).toEqual([
      'section:intro:4', 'section:main:16', 'pattern:A:4', 'pattern:B:8',
    ])
  })
})

describe('trackMuteValues', () => {
  it('mutes a Track # in every pattern, the given pattern last', () => {
    const a = rampPattern('a', 4, 40)
    const a2 = newTrack('inst_lead', 4)
    a2.id = 'trk_a2'
    a.pattern.trackIds.push(a2.id)
    const b = rampPattern('b', 4, 60)
    const doc = makeDoc([a.track, a2, b.track], [a.pattern, b.pattern])

    const values = trackMuteValues(doc, (n) => n === 2, 'a')
    expect(values).toEqual([
      ['tracker:inst_lead:ts:0:mute', 1], // b, track 1
      ['tracker:inst_lead:ts:0:mute', 1], // a, track 1
      ['tracker:inst_lead:ts:1:mute', 0], // a, track 2
    ])
  })
})

describe('playback data helpers', () => {
  const doc = rampDoc(4, 3)
  const A = buildPlaybackData(doc, [{ patternId: 'a', startRow: 0 }])
  const B = buildPlaybackData(doc, [{ patternId: 'b', startRow: 0 }])

  it('concatenates rows and shifts the second arrangement', () => {
    const ab = concatPlaybackData(A, B)
    expect(ab.totalRows).toBe(7)
    expect([0, 3, 4, 6].map((r) => freqAt(ab, r))).toEqual([freqAt(A, 0), freqAt(A, 3), freqAt(B, 0), freqAt(B, 2)])
    expect(ab.arrangement.map((it) => it.startRow)).toEqual([0, 4])
  })

  it('tiles rows modulo the source length', () => {
    const t = tilePlaybackData(B, 7)
    expect(t.totalRows).toBe(7)
    expect([0, 3, 6].map((r) => freqAt(t, r))).toEqual([freqAt(B, 0), freqAt(B, 0), freqAt(B, 0)])
    expect(t.arrangement.map((it) => it.startRow)).toEqual([0, 3, 6])
  })
})

describe('nextBoundary', () => {
  it('snaps past the margin onto the grid, capped at the loop end', () => {
    expect(nextBoundary(5, 64, 16, 2)).toBe(16)
    expect(nextBoundary(15, 64, 16, 2)).toBe(32)
    expect(nextBoundary(60, 64, 16, 2)).toBe(64)
    expect(nextBoundary(3, 64, 0, 2)).toBe(64)
  })
})

describe('planTransition', () => {
  // The switch row is always more than the max lag ahead — nextBoundary's margin.
  const cases: [string, number, number, number, number][] = [
    // name, lenA, lenB, start row, switch row
    ['longer → shorter at the loop end', 8, 3, 2, 8],
    ['shorter → longer at the loop end', 3, 8, 0, 3],
    ['mid-loop boundary', 16, 4, 1, 8],
    ['equal lengths', 4, 4, 0, 4],
  ]

  for (const [name, lenA, lenB, start, at] of cases) {
    for (const lag of [0, 1, 2]) {
      it(`${name} plays from, then loops to (lag ${lag})`, () => {
        const doc = rampDoc(lenA, lenB)
        const A = buildPlaybackData(doc, [{ patternId: 'a', startRow: 0 }])
        const B = buildPlaybackData(doc, [{ patternId: 'b', startRow: 0 }])
        const rows = (at - start) + lenB * 5
        const expected = [
          ...Array.from({ length: at - start }, (_, i) => freqAt(A, start + i)),
          ...Array.from({ length: lenB * 5 }, (_, i) => freqAt(B, i)),
        ]
        expect(simulate(A, B, start, at, lag, rows)).toEqual(expected)
      })
    }
  }

  it('a bridge landing after the wrap plays `from` once more, then hands over', () => {
    const doc = rampDoc(3, 4)
    const A = buildPlaybackData(doc, [{ patternId: 'a', startRow: 0 }])
    const B = buildPlaybackData(doc, [{ patternId: 'b', startRow: 0 }])
    // Rows 1, 2 of `from`, the wrap, the bridge lands: `from` again, then `to` looping.
    const expected = [1, 2, 0, 1, 2].map((r) => freqAt(A, r))
      .concat(Array.from({ length: 11 }, (_, i) => freqAt(B, i)))
    expect(simulate(A, B, 1, 3, 2, 16)).toEqual(expected)
  })

  it('clamps the switch row into the source loop', () => {
    const doc = rampDoc(4, 2)
    const A = buildPlaybackData(doc, [{ patternId: 'a', startRow: 0 }])
    const B = buildPlaybackData(doc, [{ patternId: 'b', startRow: 0 }])
    const plan = planTransition(A, B, 99)
    expect(plan.at).toBe(4)
    expect(plan.bridge.totalRows).toBe(6)
    expect(plan.bridge.rowOffset).toBeUndefined()
  })
})

describe('hand-over on the txSeq node', () => {
  // One row per block (rowsPerSec = SR / BLOCK); testOut mirrors slot 0's freq channel.
  const SR = 44100
  const BLOCK = 128
  const FREQ = 1

  /** One slot whose freq on row r is base + r, so the output names the row playing. */
  function ramp(rows: number, base: number): PlaybackData {
    const signals = Array.from({ length: 11 }, () => new Array<number>(rows).fill(0))
    signals[FREQ] = Array.from({ length: rows }, (_, r) => base + r)
    return { slots: [{ instId: 'i1', slotIndex: 0, signals, drumGateCount: 0 }], totalRows: rows, arrangement: [] }
  }

  for (const [lenA, lenB, quantum] of [[8, 3, 8], [3, 8, 3], [16, 4, 4]]) {
    it(`moves ${lenA} rows → ${lenB} rows on a ${quantum}-row boundary without a restart`, async () => {
      const A = ramp(lenA, 100)
      const B = ramp(lenB, 200)
      const core = new OfflineRenderer()
      let lastRow = -1
      ;(core as unknown as { on: (type: string, fn: (e: { row?: number }) => void) => void })
        .on('txseq', (e) => { if (typeof e.row === 'number') lastRow = e.row })
      await core.initialize({ numInputChannels: 0, numOutputChannels: 2, sampleRate: SR, blockSize: BLOCK, virtualFileSystem: { a: buildTxSeqData(A) } })

      let rev = 0
      const send = async (type: 'play' | 'update', data: PlaybackData) => {
        const dataPath = `d${rev++}`
        await core.updateVirtualFileSystem({ [dataPath]: buildTxSeqData(data) })
        await core.render(createNode('txseq', {
          key: 'txseq',
          cmd: { type, sessionId: 1, rowsPerSec: SR / BLOCK, startRow: 0, totalRows: data.totalRows, dataPath },
          dataPath, testOut: FREQ, emitEvery: 1,
        }, []) as never)
      }
      const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
      const block = () => { core.process([], out); return Math.round(out[0][BLOCK - 1]) }

      await send('play', A)
      for (let i = 0; i < 8 + 1; i++) block() // past the root fade-in, one row into the loop

      const plan = planTransition(A, B, nextBoundary(lastRow, lenA, quantum, 1))
      await send('update', plan.bridge)
      let stage: TransitionStage = 'bridge'
      const played: number[] = []
      for (let i = 0; i < plan.at + lenB * 4; i++) {
        played.push(block())
        const step = stepTransition(plan, stage, true, lastRow)
        if (step.send === 'settle') { stage = 'settle'; await send('update', plan.settle) }
        if (step.send === 'target') await send('update', plan.target)
      }

      const firstB = played.indexOf(200)
      expect(firstB).toBeGreaterThan(0)
      // `from` runs on uninterrupted up to the switch row…
      played.slice(0, firstB).forEach((v, i) => expect(v).toBe(played[0] + i))
      expect(played[firstB - 1]).toBe(100 + plan.at - 1)
      // …then `to` loops from its top.
      played.slice(firstB).forEach((v, i) => expect(v).toBe(200 + (i % lenB)))
      expect(played.length - firstB).toBeGreaterThan(lenB * 3)
    })
  }
})
