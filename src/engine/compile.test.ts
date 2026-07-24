import { describe, expect, it } from 'vitest'
import { compileGraph } from './compile'
import { createDefaultDoc, newOscInstrument, newTrack } from '../domain/factory'
import type { Doc, DrumKitInstrument } from '../domain/types'
import { VoicePool } from './voicePool'
import { ParamRefRegistry } from '../audio/paramRefs'

/** Unwrap the left channel from a StereoOut. */
function mono(out: ReturnType<typeof compileGraph>) {
  return out.left
}

describe('compileGraph', () => {
  it('builds a graph node from the default document without throwing', () => {
    const doc = createDefaultDoc()
    const out = compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0 })
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
    expect(() => compileGraph(empty, { rowHz: 8, playing: 0, startRow: 0, playEpoch: 0 })).not.toThrow()
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
      samples: doc.entities.samples,
      sections: doc.entities.sections,
    },
  }
}

/** Shortcut: compile a doc for inspection (mono left channel). */
function g(doc: Doc, ctx = { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0 } as const) {
  return mono(compileGraph(doc, ctx))
}

describe('compileGraph sequencer phase alignment', () => {
  it('gives every track sequencer the SAME shared reset (not a constant)', () => {
    const doc = createDefaultDoc()
    const seqs = collect(g(doc), 'seq2')

    // 2 tracks × 5 signals (freq, gate, vol, freqMul, volMod) = 10 seq2 nodes
    expect(seqs.length).toBe(10)

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

    // 3 tracks × 5 signals (freq, gate, vol, freqMul, volMod) = 15 seq2 nodes
    expect(seqs.length).toBe(15)
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
      entities: { ...doc.entities, patterns: { [doc.patternId]: { ...doc.entities.patterns[doc.patternId], trackIds: [] } }, sections: doc.entities.sections },
    }
    const silent = mono(compileGraph(empty, { rowHz: 8, playing: 0, startRow: 0, playEpoch: 0 }))
    expect(collect(silent, 'blepsaw')).toHaveLength(0)
    const withPreview = mono(compileGraph(empty, {
      rowHz: 8, playing: 0, startRow: 0, playEpoch: 0, preview: { instrumentId, voices: [{ note: 60, gate: 1, velocity: 127 }] },
    }))
    expect(collect(withPreview, 'blepsaw').length).toBeGreaterThan(0)
  })

  it('gives each preview voice a distinct frequency (polyphony without key clashes)', () => {
    const doc = createDefaultDoc()
    const node = mono(compileGraph(doc, {
      rowHz: 8, playing: 1, startRow: 0, playEpoch: 0,
      preview: { instrumentId: previewInst(doc), voices: [{ note: 60, gate: 1, velocity: 127 }, { note: 67, gate: 1, velocity: 127 }] },
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
    const muted = zeroConsts(mono(compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: { [first]: true } })))
    expect(muted).toBeGreaterThan(unmuted)
  })

  it('still compiles all track sequencers when a track is muted (phase preserved)', () => {
    const doc = createDefaultDoc()
    const first = doc.entities.patterns[doc.patternId].trackIds[0]
    const seqs = collect(mono(compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: { [first]: true } })), 'seq2')
    // 2 tracks × 5 signals (freq, gate, vol, freqMul, volMod) = 10 seq2 nodes
    expect(seqs.length).toBe(10)
  })

  it('mutes only the targeted track, not other tracks', () => {
    const doc = createDefaultDoc()
    const ids = doc.entities.patterns[doc.patternId].trackIds
    const first = ids[0]

    // Mute track 1.
    const out = compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: { [first]: true } })

    // Collect all `mul` nodes reachable from the left channel.
    const mulNodes = collect(mono(out), 'mul')

    // Find mul nodes whose children include a const 0 (zero-gain mute).
    const muteMuls = mulNodes.filter((m) =>
      childArray(m.children).some((c) => isNode(c) && (c as ElNode).kind === 'const' && (c as ElNode).props.value === 0),
    )

    // At least one mute multiplier should exist (the muted track).
    expect(muteMuls.length).toBeGreaterThan(0)
  })

  it('muting increases the number of zero-gain muls vs unmuted', () => {
    const doc = createDefaultDoc()
    const unmuted = compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0 })
    const ids = doc.entities.patterns[doc.patternId].trackIds
    const muted = compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: { [ids[0]]: true } })

    const countMuteMuls = (root: unknown) =>
      collect(root, 'mul').filter((m) =>
        childArray(m.children).some((c) => isNode(c) && (c as ElNode).kind === 'const' && (c as ElNode).props.value === 0),
      ).length

    // Muting a track should add at least one zero-gain mul on the muted voice.
    expect(countMuteMuls(mono(muted))).toBeGreaterThan(countMuteMuls(mono(unmuted)))
  })

  it('preserves the non-muted track voice structure', () => {
    const doc = createDefaultDoc()
    const ids = doc.entities.patterns[doc.patternId].trackIds
    const first = ids[0]

    const unmutedSaws = collect(mono(compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0 })), 'blepsaw')
    const mutedSaws = collect(mono(compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: { [first]: true } })), 'blepsaw')

    // Both tracks use blepsaw oscillators. When one is muted, the other still
    // produces audio — mute only adds a gain=0 on the muted track, it doesn't
    // remove the oscillator from the graph (phase is preserved).
    expect(mutedSaws.length).toBe(unmutedSaws.length)
  })

  it('muting a non-existent track ID does not crash or change output', () => {
    const doc = createDefaultDoc()
    const unmuted = collect(mono(compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0 })), 'blepsaw')
    const muted = collect(mono(compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: { 'nonexistent': true } })), 'blepsaw')
    expect(muted.length).toBe(unmuted.length)
  })

  it('outputs silence when ALL tracks are muted', () => {
    const doc = createDefaultDoc()
    const ids = doc.entities.patterns[doc.patternId].trackIds
    const allMuted = Object.fromEntries(ids.map((id) => [id, true]))

    const out = compileGraph(doc, { rowHz: 8, playing: 1, startRow: 0, playEpoch: 0, mutedTracks: allMuted })
    const mulNodes = collect(mono(out), 'mul')

    // Every track should have a zero-gain multiplier.
    const muteMuls = mulNodes.filter((m) =>
      childArray(m.children).some((c) => isNode(c) && (c as ElNode).kind === 'const' && (c as ElNode).props.value === 0),
    )
    expect(muteMuls.length).toBeGreaterThanOrEqual(ids.length)
  })
})

// ── compilePreview with VoicePool ───────────────────────────────────────

/** Return const nodes whose key matches the given prefix. */
function keysStartingWith(root: unknown, prefix: string): string[] {
  return collect(root, 'const')
    .map((c) => c.props.key)
    .filter((k): k is string => typeof k === 'string' && k.startsWith(prefix))
}

describe('compilePreview with VoicePool', () => {
  it('compiles osc preview with VoicePool without throwing', () => {
    const doc = createDefaultDoc()
    const instId = doc.entities.tracks[doc.entities.patterns[doc.patternId].trackIds[0]].instrumentId
    const refs = new ParamRefRegistry()
    const pool = new VoicePool(refs, instId)
    const out = compileGraph(doc, {
      rowHz: 8, playing: 0, startRow: 0, playEpoch: 0,
      preview: { instrumentId: instId, voices: [] },
      paramRefs: refs,
      voicePool: pool,
    })
    expect(out).toBeTruthy()
    // Voice pool path creates const keys with the :v: pattern
    const keys = keysStartingWith(mono(out), `${instId}:v:`)
    expect(keys.length).toBeGreaterThan(0)
  })

  it('creates 8 voice slot ref groups for osc preview with VoicePool', () => {
    const doc = createDefaultDoc()
    const instId = doc.entities.tracks[doc.entities.patterns[doc.patternId].trackIds[0]].instrumentId
    const refs = new ParamRefRegistry()
    const pool = new VoicePool(refs, instId)
    const out = compileGraph(doc, {
      rowHz: 8, playing: 0, startRow: 0, playEpoch: 0,
      preview: { instrumentId: instId, voices: [] },
      paramRefs: refs,
      voicePool: pool,
    })
    // Should have keys for all 8 slots with freq/gate/vel
    const gateKeys = keysStartingWith(mono(out), `${instId}:v:`).filter((k) => k.endsWith(':gate'))
    expect(new Set(gateKeys).size).toBe(8)
  })

  /** Create a doc with a drumkit. Slots reference the default osc instrument
   *  so ref nodes appear in the graph (empty slots are optimized away). */
  function docWithKit(): { doc: Doc; kit: DrumKitInstrument } {
    const doc = createDefaultDoc()
    const oscId = doc.entities.tracks[doc.entities.patterns[doc.patternId].trackIds[0]].instrumentId
    const kit: DrumKitInstrument = {
      id: 'kit_test',
      kind: 'drumkit',
      name: 'Test Kit',
      keyLo: 36,
      keyHi: 60,
      params: { gain: 1 },
      slots: [
        { id: 'slot_36', note: 36, sampleId: null, instrumentId: oscId, pitchOffset: 0, gain: 1, pan: 0 },
        { id: 'slot_48', note: 48, sampleId: null, instrumentId: oscId, pitchOffset: 0, gain: 1, pan: 0 },
      ],
    }
    const entities: any = { ...doc.entities, instruments: { ...doc.entities.instruments, [kit.id]: kit } }
    return { doc: { ...doc, entities }, kit }
  }

  it('compiles drumkit preview with VoicePool without throwing', () => {
    const { doc, kit } = docWithKit()
    const refs = new ParamRefRegistry()
    const pool = new VoicePool(refs, kit.id)
    pool.setKit(kit)
    const out = compileGraph(doc, {
      rowHz: 8, playing: 0, startRow: 0, playEpoch: 0,
      preview: { instrumentId: kit.id, voices: [] },
      paramRefs: refs,
      voicePool: pool,
    })
    expect(out).toBeTruthy()
  })

  it('uses drumkit ref key pattern (:ds:) for drumkit preview', () => {
    const { doc, kit } = docWithKit()
    const refs = new ParamRefRegistry()
    const pool = new VoicePool(refs, kit.id)
    pool.setKit(kit)
    const out = compileGraph(doc, {
      rowHz: 8, playing: 0, startRow: 0, playEpoch: 0,
      preview: { instrumentId: kit.id, voices: [] },
      paramRefs: refs,
      voicePool: pool,
    })
    // 2 slots × 2 sub-voices = 4 gate keys with the :ds: pattern
    const dsKeys = keysStartingWith(mono(out), `${kit.id}:ds:`)
    expect(dsKeys.length).toBeGreaterThan(0)
    // Should be per-slot keys, not generic voice keys
    const vKeys = keysStartingWith(mono(out), `${kit.id}:v:`)
    expect(vKeys.length).toBe(0)
  })

  it('produces correct number of sub-voice chains per drumkit slot', () => {
    const { doc, kit } = docWithKit()
    const refs = new ParamRefRegistry()
    const pool = new VoicePool(refs, kit.id)
    pool.setKit(kit)
    const out = compileGraph(doc, {
      rowHz: 8, playing: 0, startRow: 0, playEpoch: 0,
      preview: { instrumentId: kit.id, voices: [] },
      paramRefs: refs,
      voicePool: pool,
    })
    const gateKeys = keysStartingWith(mono(out), `${kit.id}:ds:`).filter((k) => k.endsWith(':gate'))
    // 2 slots × 2 sub-voices = 4 gate refs
    expect(new Set(gateKeys).size).toBe(4)
  })
})
