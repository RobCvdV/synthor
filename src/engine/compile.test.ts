import { describe, expect, it } from 'vitest'
import { el } from '@elemaudio/core'
import { compileGraph } from '../engine/compile'
import type { RenderContext } from '../engine/compile'
import { buildArrangement } from '../engine/arrangement'
import { newTrack, newOscInstrument, createMasterChannel, newDrumKitInstrument } from '../domain/factory'
import { MASTER_CHANNEL_ID } from '../domain/types'
import type { Doc, Pattern, Id } from '../domain/types'

/** Build a minimal Doc with the given patterns and their corresponding tracks + instruments.
 *  Each pattern's trackIds must reference tracks from `allTracks`, and each track's
 *  instrumentId must reference instruments from `allInstruments`. */
function makeDoc(patterns: { id: Id; name: string; length: number }[]): {
  doc: Doc
  instIds: Id[]
  trackIds: Id[]
} {
  const master = createMasterChannel()
  const insts: Record<Id, ReturnType<typeof newOscInstrument>> = {}
  const tracks: Record<Id, ReturnType<typeof newTrack>> = {}
  const pats: Record<Id, Pattern> = {}
  const instIds: Id[] = []
  const trackIds: Id[] = []

  for (const p of patterns) {
    const inst = newOscInstrument(`Inst-${p.id}`)
    insts[inst.id] = inst
    instIds.push(inst.id)
    const track = newTrack(inst.id, p.length)
    track.cells[0].note = 60 // non-empty sequence
    tracks[track.id] = track
    trackIds.push(track.id)
    pats[p.id] = { id: p.id, name: p.name, length: p.length, trackIds: [track.id] }
  }

  const doc: Doc = {
    entities: {
      instruments: insts,
      tracks,
      patterns: pats,
      sections: {},
      samples: {},
      mixChannels: { [MASTER_CHANNEL_ID]: master },
      mixerInstrumentOrder: instIds,
    },
    patternId: patterns[0]?.id ?? '',
    sectionIds: [],
  }
  return { doc, instIds, trackIds }
}

function defaultCtx(overrides?: Partial<RenderContext>): RenderContext {
  return { rowHz: 8, playing: 1, startRow: 0, playEpoch: 1, ...overrides }
}

describe('compileGraph', () => {
  // ── Single-pattern (backward compat) ──────────────────────
  it('compiles a single pattern when no arrangement is provided', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'Test', length: 64 }])
    const out = compileGraph(doc, defaultCtx())
    expect(out).toBeDefined()
    expect(out.left).toBeDefined()
    expect(out.right).toBeDefined()
  })

  it('returns silence when pattern does not exist', () => {
    const master = createMasterChannel()
    const doc: Doc = {
      entities: { instruments: {}, tracks: {}, patterns: {}, sections: {}, samples: {},
        mixChannels: { [MASTER_CHANNEL_ID]: master }, mixerInstrumentOrder: [] },
      patternId: 'nonexistent',
      sectionIds: [],
    }
    const out = compileGraph(doc, defaultCtx())
    expect(out).toBeDefined()
  })

  it('returns silence when arrangement has zero totalRows', () => {
    // All patterns have length 0 → totalRows = 0 → silence
    const emptyPat: Pattern = { id: 'empty', name: 'Empty', length: 0, trackIds: [] }
    const master = createMasterChannel()
    const doc: Doc = {
      entities: { instruments: {}, tracks: {}, patterns: { empty: emptyPat }, sections: {}, samples: {},
        mixChannels: { [MASTER_CHANNEL_ID]: master }, mixerInstrumentOrder: [] },
      patternId: 'empty',
      sectionIds: [],
    }
    const out = compileGraph(doc, defaultCtx({ arrangement: [{ patternId: 'empty', startRow: 0 }] }))
    expect(out).toBeDefined()
  })

  // ── Flattened arrangement ─────────────────────────────────
  it('compiles a flattened arrangement with two patterns', () => {
    const { doc } = makeDoc([
      { id: 'p1', name: 'P1', length: 16 },
      { id: 'p2', name: 'P2', length: 16 },
    ])
    const arrangement = [
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 16 },
    ]
    const ctx = defaultCtx({ arrangement })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
    expect(out.left).toBeDefined()
    expect(out.right).toBeDefined()
  })

  it('compiles flattened arrangement with three patterns of different lengths', () => {
    const { doc } = makeDoc([
      { id: 'p1', name: 'P1', length: 16 },
      { id: 'p2', name: 'P2', length: 32 },
      { id: 'p3', name: 'P3', length: 8 },
    ])
    const arrangement = buildArrangement(
      { ...doc, sectionIds: ['s1'], entities: { ...doc.entities, sections: { s1: { id: 's1', name: 'All', patternIds: ['p1', 'p2', 'p3'] } } } },
      'song',
    )
    const ctx = defaultCtx({ arrangement })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
  })

  it('handles stale pattern references in arrangement gracefully', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const arrangement = [
      { patternId: 'p1', startRow: 0 },
      { patternId: 'missing', startRow: 16 },
    ]
    const ctx = defaultCtx({ arrangement })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
  })

  it('handles empty arrangement by falling back to doc.patternId', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const ctx = defaultCtx({ arrangement: [] })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
  })

  // ── Arrangement fallback ──────────────────────────────────
  it('uses single-pattern mode when arrangement has exactly 1 item', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'P1', length: 64 }])
    const ctx = defaultCtx({ arrangement: [{ patternId: 'p1', startRow: 0 }] })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
  })

  // ── Live voices ───────────────────────────────────────────
  it('compiles with live voice slots for all instruments', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const ctx = defaultCtx()
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
    expect(out.left).toBeDefined()
    expect(out.right).toBeDefined()
  })

  // ── Start row offset ──────────────────────────────────────
  it('handles non-zero startRow with arrangement', () => {
    const { doc } = makeDoc([
      { id: 'p1', name: 'P1', length: 16 },
      { id: 'p2', name: 'P2', length: 16 },
    ])
    const ctx = defaultCtx({
      startRow: 8,
      arrangement: [
        { patternId: 'p1', startRow: 0 },
        { patternId: 'p2', startRow: 16 },
      ],
    })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
  })

  // ── Muted tracks ──────────────────────────────────────────
  it('handles muted tracks', () => {
    const { doc, trackIds } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const ctx = defaultCtx({ mutedTracks: { [trackIds[0]]: true } })
    const out = compileGraph(doc, ctx)
    expect(out).toBeDefined()
  })
})

// ── compileLiveVoices (with paramRefs) ──────────────────────────

/** Minimal mock of ParamRefRegistry — records keys and returns el.const nodes.
 *  Lets us verify compileLiveVoices creates the expected voice-slot refs
 *  without needing a real WebRenderer. */
function mockParamRefs() {
  const keys = new Set<string>()
  return {
    keys,
    getOrCreate(key: string, value: number) {
      keys.add(key)
      return el.const({ key, value })
    },
  }
}

/** Build a Doc with instruments but no patterns, so we can isolate
 *  compileLiveVoices from the pattern compilation path. */
function makeInstrumentsDoc(instrumentCount: number): Doc {
  const master = createMasterChannel()
  const insts: Record<Id, ReturnType<typeof newOscInstrument>> = {}
  const instIds: Id[] = []
  for (let i = 0; i < instrumentCount; i++) {
    const inst = newOscInstrument(`Inst-${i}`)
    insts[inst.id] = inst
    instIds.push(inst.id)
  }
  return {
    entities: {
      instruments: insts,
      tracks: {},
      patterns: {},
      sections: {},
      samples: {},
      mixChannels: { [MASTER_CHANNEL_ID]: master },
      mixerInstrumentOrder: instIds,
    },
    patternId: '',
    sectionIds: [],
  }
}

describe('compileLiveVoices', () => {
  it('returns null when paramRefs is not provided', () => {
    const doc = makeInstrumentsDoc(1)
    const out = compileGraph(doc, defaultCtx())
    expect(out).toBeDefined()
  })

  it('creates voice-slot refs for the live instrument', () => {
    const { doc, instIds } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const refs = mockParamRefs()
    compileGraph(doc, defaultCtx({ paramRefs: refs as any }))
    // 1 instrument → 4 voices. 4×3 voice refs + 1 gain + 1 pan = 14 refs.
    expect(refs.keys.size).toBeGreaterThanOrEqual(12)
    expect(refs.keys.has(`${instIds[0]}:v:0:freq`)).toBe(true)
    expect(refs.keys.has(`${instIds[0]}:v:0:gate`)).toBe(true)
    expect(refs.keys.has(`${instIds[0]}:v:0:vel`)).toBe(true)
  })

  it('creates refs for all voice slots per instrument', () => {
    const { doc, instIds } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const refs = mockParamRefs()
    compileGraph(doc, defaultCtx({ paramRefs: refs as any }))
    for (let i = 0; i < 4; i++) {
      expect(refs.keys.has(`${instIds[0]}:v:${i}:freq`)).toBe(true)
      expect(refs.keys.has(`${instIds[0]}:v:${i}:gate`)).toBe(true)
      expect(refs.keys.has(`${instIds[0]}:v:${i}:vel`)).toBe(true)
    }
  })

  it('creates drumkit slot refs with gain', () => {
    const master = createMasterChannel()
    const kit = newDrumKitInstrument('Kit')
    kit.slots = [{ id: 'slot1', note: 36, pitchOffset: 0, gain: 1, pan: 0, sampleId: 'smp1', instrumentId: null }]
    const doc: Doc = {
      entities: {
        instruments: { [kit.id]: kit },
        tracks: {},
        patterns: {},
        sections: {},
        samples: { smp1: { id: 'smp1', name: 'kick', hash: 'abc123', originalName: 'kick.wav', sampleRate: 44100, channels: 1, frames: 1000 } },
        mixChannels: { [MASTER_CHANNEL_ID]: master },
        mixerInstrumentOrder: [kit.id],
      },
      patternId: '',
      sectionIds: [],
    }
    const refs = mockParamRefs()
    compileGraph(doc, defaultCtx({ paramRefs: refs as any, vfsLoadedHashes: new Set(['abc123']) }))
    // 1 slot × 1 sub-voice × 3 refs (freq, gate, vel) + 1 gain = 4 refs
    expect(refs.keys.has(`${kit.id}:ds:0:v0:freq`)).toBe(true)
    expect(refs.keys.has(`${kit.id}:ds:0:v0:gate`)).toBe(true)
    expect(refs.keys.has(`${kit.id}:ds:0:v0:vel`)).toBe(true)
    expect(refs.keys.has(`${kit.id}:gain`)).toBe(true)
  })

  it('refs use gate=0, vel=1, freq=midiToFreq(69) initial values', () => {
    const { doc, instIds } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const calls: { key: string; value: number }[] = []
    const refs = {
      keys: new Set<string>(),
      getOrCreate(key: string, value: number) {
        calls.push({ key, value })
        return el.const({ key, value })
      },
    }
    compileGraph(doc, defaultCtx({ paramRefs: refs as any }))
    expect(calls.find((c) => c.key === `${instIds[0]}:v:0:gate`)?.value).toBe(0)
    expect(calls.find((c) => c.key === `${instIds[0]}:v:0:freq`)?.value).toBe(440)
    expect(calls.find((c) => c.key === `${instIds[0]}:v:0:vel`)?.value).toBe(1)
  })

  it('mixes live voices with pattern output when playing', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const refs = mockParamRefs()
    const out = compileGraph(doc, defaultCtx({ paramRefs: refs as any, playing: 1 }))
    expect(out).toBeDefined()
    expect(out.left).toBeDefined()
    expect(out.right).toBeDefined()
  })

  it('live voices outside play gate — active even when stopped', () => {
    const { doc } = makeDoc([{ id: 'p1', name: 'P1', length: 16 }])
    const refs = mockParamRefs()
    const out = compileGraph(doc, defaultCtx({ paramRefs: refs as any, playing: 0 }))
    expect(out).toBeDefined()
  })
})
