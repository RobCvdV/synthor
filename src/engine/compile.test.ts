import { describe, expect, it } from 'vitest'
import { compileGraph } from './compile'
import { createDefaultDoc, newOscInstrument, newTrack } from '../domain/factory'
import type { Doc } from '../domain/types'

/** Unwrap the left channel from a StereoOut. */
function mono(out: ReturnType<typeof compileGraph>) {
  return out.left
}

describe('compileGraph', () => {
  it('builds a graph node from the default document without throwing', () => {
    const doc = createDefaultDoc()
    const out = compileGraph(doc, { rowHz: 8, playing: 1 })
    expect(out.left).toBeTruthy()
    expect(out.right).toBeTruthy()
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

/** Shortcut: compile a doc for inspection (mono left channel). */
function g(doc: Doc, ctx = { rowHz: 8, playing: 1 } as const) {
  return mono(compileGraph(doc, ctx))
}

describe('compileGraph sequencer phase alignment', () => {
  it('gives every track sequencer the SAME shared reset (not a constant)', () => {
    const doc = createDefaultDoc()
    const seqs = collect(g(doc), 'seq2')

    expect(seqs.length).toBe(4)

    const resets = seqs.map((s) => seqInputs(s).reset)
    for (const r of resets) {
      expect(isNode(r)).toBe(true)
      expect((r as ElNode).kind).not.toBe('const')
    }
    const resetHashes = new Set(resets.map((r) => (r as ElNode).hash))
    expect(resetHashes.size).toBe(1)
  })

  it('shares one clock and one reset, and they are distinct signals', () => {
    const doc = createDefaultDoc()
    const seqs = collect(g(doc), 'seq2')

    const triggerHashes = new Set(seqs.map((s) => seqInputs(s).trigger.hash))
    const resetHashes = new Set(seqs.map((s) => (seqInputs(s).reset as ElNode).hash))

    expect(triggerHashes.size).toBe(1)
    expect(resetHashes.size).toBe(1)
    expect([...triggerHashes][0]).not.toBe([...resetHashes][0])
  })

  it('keeps the shared reset when a track is added (the duplicate scenario)', () => {
    const doc = withExtraTrack(createDefaultDoc())
    const seqs = collect(g(doc), 'seq2')

    expect(seqs.length).toBe(6)
    const resetHashes = new Set(seqs.map((s) => (seqInputs(s).reset as ElNode).hash))
    expect(resetHashes.size).toBe(1)
  })
})

function zeroConsts(root: unknown) {
  return collect(root, 'const').filter((c) => c.props.value === 0).length
}

describe('compileGraph preview', () => {
  const previewInst = (doc: Doc) => doc.entities.tracks[doc.entities.patterns[doc.patternId].trackIds[0]].instrumentId

  it('sounds a held note even when the transport is stopped', () => {
    const doc = createDefaultDoc()
    const instrumentId = previewInst(doc)
    const empty: Doc = {
      ...doc,
      entities: { ...doc.entities, patterns: { [doc.patternId]: { ...doc.entities.patterns[doc.patternId], trackIds: [] } } },
    }
    const silent = mono(compileGraph(empty, { rowHz: 8, playing: 0 }))
    expect(collect(silent, 'blepsaw')).toHaveLength(0)
    const withPreview = mono(compileGraph(empty, {
      rowHz: 8, playing: 0, preview: { instrumentId, voices: [{ note: 60, gate: 1 }] },
    }))
    expect(collect(withPreview, 'blepsaw').length).toBeGreaterThan(0)
  })

  it('gives each preview voice a distinct frequency (polyphony without key clashes)', () => {
    const doc = createDefaultDoc()
    const node = mono(compileGraph(doc, {
      rowHz: 8, playing: 1,
      preview: { instrumentId: previewInst(doc), voices: [{ note: 60, gate: 1 }, { note: 67, gate: 1 }] },
    }))
    const previewFreqKeys = collect(node, 'const')
      .map((c) => c.props.key)
      .filter((k): k is string => typeof k === 'string' && k.includes(':freq') && k.startsWith('preview:'))
    expect(new Set(previewFreqKeys).size).toBe(2)
  })
})

describe('compileGraph mute', () => {
  it('adds a zero-gain multiplier for a muted track (and none when unmuted)', () => {
    const doc = createDefaultDoc()
    const first = doc.entities.patterns[doc.patternId].trackIds[0]
    const unmuted = zeroConsts(g(doc))
    const muted = zeroConsts(mono(compileGraph(doc, { rowHz: 8, playing: 1, mutedTracks: { [first]: true } })))
    expect(muted).toBeGreaterThan(unmuted)
  })

  it('still compiles all track sequencers when a track is muted (phase preserved)', () => {
    const doc = createDefaultDoc()
    const first = doc.entities.patterns[doc.patternId].trackIds[0]
    const seqs = collect(mono(compileGraph(doc, { rowHz: 8, playing: 1, mutedTracks: { [first]: true } })), 'seq2')
    expect(seqs.length).toBe(4)
  })
})
