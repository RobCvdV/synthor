import { describe, expect, it } from 'vitest'
import { buildArrangement } from '../engine/arrangement'
import { newTrack, newSection, newOscInstrument, createMasterChannel } from '../domain/factory'
import { MASTER_CHANNEL_ID } from '../domain/types'
import type { Doc, Pattern, Section } from '../domain/types'

/** Build a minimal Doc for testing arrangement logic. */
function makeDoc(opts: {
  patternId: string
  patterns: Record<string, Pattern>
  sections?: Record<string, Section>
  sectionIds?: string[]
}): Doc {
  const inst = newOscInstrument('Test')
  const track = newTrack(inst.id, 64)
  const master = createMasterChannel()
  return {
    entities: {
      instruments: { [inst.id]: inst },
      tracks: { [track.id]: track },
      patterns: opts.patterns,
      sections: opts.sections ?? {},
      samples: {},
      mixChannels: { [MASTER_CHANNEL_ID]: master },
      mixerInstrumentOrder: [inst.id],
    },
    patternId: opts.patternId,
    sectionIds: opts.sectionIds ?? [],
  }
}

function makePattern(id: string, length = 64, name = 'Test'): Pattern {
  const inst = newOscInstrument('Inst')
  const track = newTrack(inst.id, length)
  return { id, name, length, trackIds: [track.id] }
}

describe('buildArrangement', () => {
  // ── Pattern mode ────────────────────────────────────────────
  it('pattern mode returns single current pattern with startRow 0', () => {
    const pat = makePattern('p1', 64)
    const doc = makeDoc({ patternId: 'p1', patterns: { p1: pat } })
    const result = buildArrangement(doc, 'pattern')
    expect(result).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('pattern mode returns empty array when pattern does not exist', () => {
    const doc = makeDoc({ patternId: 'missing', patterns: {} })
    const result = buildArrangement(doc, 'pattern')
    expect(result).toEqual([])
  })

  // ── Section mode ────────────────────────────────────────────
  it('section mode finds section containing current pattern', () => {
    const p1 = makePattern('p1', 64)
    const p2 = makePattern('p2', 32)
    const sec = newSection('Verse')
    sec.patternIds = ['p1', 'p2']
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1, p2 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'section')
    expect(result).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 64 },
    ])
  })

  it('section mode finds section when current is second pattern', () => {
    const p1 = makePattern('p1', 64)
    const p2 = makePattern('p2', 32)
    const sec = newSection('Verse')
    sec.patternIds = ['p1', 'p2']
    const doc = makeDoc({
      patternId: 'p2',
      patterns: { p1, p2 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'section')
    expect(result).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 64 },
    ])
  })

  it('section mode falls back to single pattern when not in any section', () => {
    const p1 = makePattern('p1', 64)
    const p2 = makePattern('p2', 32)
    const sec = newSection('Verse')
    sec.patternIds = ['p2'] // p1 is NOT in the section
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1, p2 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'section')
    expect(result).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('section mode skips stale pattern references in section', () => {
    const p1 = makePattern('p1', 64)
    const sec = newSection('Verse')
    sec.patternIds = ['p1', 'missing_pat', 'p1'] // duplicate + missing
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'section')
    expect(result).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p1', startRow: 64 },
    ])
  })

  // ── Song mode ───────────────────────────────────────────────
  it('song mode concatenates all sections in order', () => {
    const p1 = makePattern('p1', 64)
    const p2 = makePattern('p2', 32)
    const p3 = makePattern('p3', 48)
    const sec1 = newSection('Intro')
    sec1.patternIds = ['p1']
    const sec2 = newSection('Verse')
    sec2.patternIds = ['p2', 'p3']
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1, p2, p3 },
      sections: { [sec1.id]: sec1, [sec2.id]: sec2 },
      sectionIds: [sec1.id, sec2.id],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 64 },
      { patternId: 'p3', startRow: 96 },
    ])
  })

  it('song mode skips empty sections', () => {
    const p1 = makePattern('p1', 64)
    const sec1 = newSection('Intro')
    sec1.patternIds = []
    const sec2 = newSection('Verse')
    sec2.patternIds = ['p1']
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1 },
      sections: { [sec1.id]: sec1, [sec2.id]: sec2 },
      sectionIds: [sec1.id, sec2.id],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('song mode skips stale section references', () => {
    const p1 = makePattern('p1', 64)
    const sec = newSection('Intro')
    sec.patternIds = ['p1']
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1 },
      sections: { [sec.id]: sec },
      sectionIds: ['missing_sec', sec.id],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('song mode falls back to single pattern when no sections', () => {
    const p1 = makePattern('p1', 64)
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1 },
      sectionIds: [],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('song mode falls back to single pattern when all sections empty', () => {
    const p1 = makePattern('p1', 64)
    const sec = newSection('Intro')
    sec.patternIds = []
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  // ── Offset correctness ─────────────────────────────────────
  it('varying pattern lengths produce correct cumulative offsets', () => {
    const p1 = makePattern('p1', 16)
    const p2 = makePattern('p2', 128)
    const p3 = makePattern('p3', 8)
    const sec = newSection('All')
    sec.patternIds = ['p1', 'p2', 'p3']
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1, p2, p3 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 16 },
      { patternId: 'p3', startRow: 144 },
    ])
  })

  it('handles patterns with length 0', () => {
    const p1 = makePattern('p1', 0)
    const p2 = makePattern('p2', 64)
    const sec = newSection('Test')
    sec.patternIds = ['p1', 'p2']
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1, p2 },
      sections: { [sec.id]: sec },
      sectionIds: [sec.id],
    })
    const result = buildArrangement(doc, 'song')
    expect(result).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 0 },
    ])
  })
})
