import { describe, expect, it } from 'vitest'
import { compileGraph } from './compile'
import { createDefaultDoc, newOscInstrument, newTrack } from '../domain/factory'
import type { Doc } from '../domain/types'

describe('compileGraph', () => {
  it('builds a graph node from the default document without throwing', () => {
    const doc = createDefaultDoc()
    const node = compileGraph(doc, { rowHz: 8, playing: 1 })
    expect(node).toBeTruthy()
  })

  it('handles an empty pattern (no tracks) by returning silence', () => {
    const doc = createDefaultDoc()
    const empty: Doc = {
      ...doc,
      entities: {
        ...doc.entities,
        patterns: {
          [doc.patternId]: { ...doc.entities.patterns[doc.patternId], trackIds: [] },
        },
      },
    }
    expect(() => compileGraph(empty, { rowHz: 8, playing: 0 })).not.toThrow()
  })
})

// --- Elementary node introspection helpers -------------------------------
// A compiled node is { symbol:'__ELEM_NODE__', hash, kind, props, children },
// where `children` is a cons-list ({hd, tl}) terminated by 0.

interface ElNode {
  symbol: string
  hash: number
  kind: string
  props: Record<string, unknown>
  children: unknown
}

function isNode(x: unknown): x is ElNode {
  return typeof x === 'object' && x !== null && (x as { symbol?: unknown }).symbol === '__ELEM_NODE__'
}

/** Flatten a node's cons-list children into an array. */
function childArray(children: unknown): unknown[] {
  const out: unknown[] = []
  let c: unknown = children
  while (typeof c === 'object' && c !== null && 'hd' in c) {
    const cell = c as unknown as { hd: unknown; tl: unknown }
    out.push(cell.hd)
    c = cell.tl
  }
  return out
}

/** Depth-first collect all nodes of a given kind. */
function collect(root: unknown, kind: string): ElNode[] {
  const found: ElNode[] = []
  const seen = new Set<ElNode>()
  const walk = (n: unknown) => {
    if (!isNode(n) || seen.has(n)) return
    seen.add(n)
    if (n.kind === kind) found.push(n)
    for (const ch of childArray(n.children)) walk(ch)
  }
  walk(root)
  return found
}

/** el.seq2(props, trigger, reset) → children [trigger, reset]. */
function seqInputs(seq: ElNode): { trigger: ElNode; reset: unknown } {
  const [trigger, reset] = childArray(seq.children)
  return { trigger: trigger as ElNode, reset }
}

function withExtraTrack(doc: Doc): Doc {
  const inst = newOscInstrument('Extra')
  const pat = doc.entities.patterns[doc.patternId]
  const trk = newTrack(inst.id, pat.length)
  return {
    ...doc,
    entities: {
      instruments: { ...doc.entities.instruments, [inst.id]: inst },
      tracks: { ...doc.entities.tracks, [trk.id]: trk },
      patterns: { ...doc.entities.patterns, [doc.patternId]: { ...pat, trackIds: [...pat.trackIds, trk.id] } },
    },
  }
}

// --- Regression: per-track sequencer phase alignment ---------------------
// Each el.seq2 keeps its own step counter, initialized to 0 when the *node* is
// created. A track added mid-playback would drift out of phase unless every
// sequencer shares a single loop-reset that re-zeroes them together. These
// tests pin that structural guarantee at the graph level.

describe('compileGraph sequencer phase alignment', () => {
  it('gives every track sequencer the SAME shared reset (not a constant)', () => {
    const doc = createDefaultDoc() // 2 tracks
    const seqs = collect(compileGraph(doc, { rowHz: 8, playing: 1 }), 'seq2')

    expect(seqs.length).toBe(4) // freq + gate per track

    const resets = seqs.map((s) => seqInputs(s).reset)
    // All resets are real nodes (a train), never the bug's constant 0.
    for (const r of resets) {
      expect(isNode(r)).toBe(true)
      expect((r as ElNode).kind).not.toBe('const')
    }
    // All sequencers share one and the same reset (identical content hash).
    const resetHashes = new Set(resets.map((r) => (r as ElNode).hash))
    expect(resetHashes.size).toBe(1)
  })

  it('shares one clock and one reset, and they are distinct signals', () => {
    const doc = createDefaultDoc()
    const seqs = collect(compileGraph(doc, { rowHz: 8, playing: 1 }), 'seq2')

    const triggerHashes = new Set(seqs.map((s) => seqInputs(s).trigger.hash))
    const resetHashes = new Set(seqs.map((s) => (seqInputs(s).reset as ElNode).hash))

    expect(triggerHashes.size).toBe(1) // one shared row clock
    expect(resetHashes.size).toBe(1) // one shared loop reset
    // Clock and reset run at different rates, so they must differ.
    expect([...triggerHashes][0]).not.toBe([...resetHashes][0])
  })

  it('keeps the shared reset when a track is added (the duplicate scenario)', () => {
    const doc = withExtraTrack(createDefaultDoc()) // 3 tracks
    const seqs = collect(compileGraph(doc, { rowHz: 8, playing: 1 }), 'seq2')

    expect(seqs.length).toBe(6)
    const resetHashes = new Set(seqs.map((s) => (seqInputs(s).reset as ElNode).hash))
    expect(resetHashes.size).toBe(1)
  })
})

describe('compileGraph mute', () => {
  const zeroConsts = (root: unknown) =>
    collect(root, 'const').filter((c) => c.props.value === 0).length

  it('adds a zero-gain multiplier for a muted track (and none when unmuted)', () => {
    const doc = createDefaultDoc()
    const first = doc.entities.patterns[doc.patternId].trackIds[0]
    const unmuted = zeroConsts(compileGraph(doc, { rowHz: 8, playing: 1 }))
    const muted = zeroConsts(compileGraph(doc, { rowHz: 8, playing: 1, mutedTracks: { [first]: true } }))
    expect(muted).toBeGreaterThan(unmuted)
  })

  it('still compiles all track sequencers when a track is muted (phase preserved)', () => {
    const doc = createDefaultDoc()
    const first = doc.entities.patterns[doc.patternId].trackIds[0]
    const seqs = collect(compileGraph(doc, { rowHz: 8, playing: 1, mutedTracks: { [first]: true } }), 'seq2')
    // Muting gains the voice to 0 but keeps its seq2 nodes in the graph.
    expect(seqs.length).toBe(4)
  })
})
