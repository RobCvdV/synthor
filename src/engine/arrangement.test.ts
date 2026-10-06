import { describe, expect, it } from 'vitest'
import {
  buildArrangement, itemIndexAt, neighbourSteps, resolveStep, startRowFor, type ArrangementItem,
} from '../engine/arrangement'
import { newTrack, newSection, newModularInstrument, createMasterChannel } from '../domain/factory'
import { MASTER_CHANNEL_ID } from '../domain/types'
import type { Doc, Pattern, Section } from '../domain/types'

/** Build a minimal Doc for testing arrangement logic. */
function makeDoc(opts: {
  patternId: string
  patterns: Record<string, Pattern>
  sections?: Record<string, Section>
  sectionIds?: string[]
}): Doc {
  const inst = newModularInstrument('Test')
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
  const inst = newModularInstrument('Inst')
  const track = newTrack(inst.id, length)
  return { id, name, length, trackIds: [track.id] }
}

/** Pattern + offset only; the section/step tags are covered separately. */
const rows = (items: ArrangementItem[]) => items.map(({ patternId, startRow }) => ({ patternId, startRow }))

describe('buildArrangement', () => {
  // ── Pattern mode ────────────────────────────────────────────
  it('pattern mode returns single current pattern with startRow 0', () => {
    const pat = makePattern('p1', 64)
    const doc = makeDoc({ patternId: 'p1', patterns: { p1: pat } })
    const result = buildArrangement(doc, 'pattern')
    expect(rows(result)).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('pattern mode returns empty array when pattern does not exist', () => {
    const doc = makeDoc({ patternId: 'missing', patterns: {} })
    const result = buildArrangement(doc, 'pattern')
    expect(rows(result)).toEqual([])
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
    expect(rows(result)).toEqual([
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
    expect(rows(result)).toEqual([
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
    expect(rows(result)).toEqual([{ patternId: 'p1', startRow: 0 }])
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
    expect(rows(result)).toEqual([
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
    expect(rows(result)).toEqual([
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
    expect(rows(result)).toEqual([{ patternId: 'p1', startRow: 0 }])
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
    expect(rows(result)).toEqual([{ patternId: 'p1', startRow: 0 }])
  })

  it('song mode falls back to single pattern when no sections', () => {
    const p1 = makePattern('p1', 64)
    const doc = makeDoc({
      patternId: 'p1',
      patterns: { p1 },
      sectionIds: [],
    })
    const result = buildArrangement(doc, 'song')
    expect(rows(result)).toEqual([{ patternId: 'p1', startRow: 0 }])
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
    expect(rows(result)).toEqual([{ patternId: 'p1', startRow: 0 }])
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
    expect(rows(result)).toEqual([
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
    expect(rows(result)).toEqual([
      { patternId: 'p1', startRow: 0 },
      { patternId: 'p2', startRow: 0 },
    ])
  })
})

/** Two sections sharing pattern p2: A = [p1, p2, p1], B = [p2, p3]. */
function sharedDoc(patternId: string) {
  const patterns = { p1: makePattern('p1', 16), p2: makePattern('p2', 32), p3: makePattern('p3', 8) }
  const a = { ...newSection('A'), id: 'A', patternIds: ['p1', 'p2', 'p1'] }
  const b = { ...newSection('B'), id: 'B', patternIds: ['p2', 'p3'] }
  return makeDoc({ patternId, patterns, sections: { A: a, B: b }, sectionIds: ['A', 'B'] })
}

describe('section steps', () => {
  it('tags every item with its section and step', () => {
    expect(buildArrangement(sharedDoc('p1'), 'song')).toEqual([
      { patternId: 'p1', startRow: 0, sectionId: 'A', step: 0 },
      { patternId: 'p2', startRow: 16, sectionId: 'A', step: 1 },
      { patternId: 'p1', startRow: 48, sectionId: 'A', step: 2 },
      { patternId: 'p2', startRow: 64, sectionId: 'B', step: 0 },
      { patternId: 'p3', startRow: 96, sectionId: 'B', step: 1 },
    ])
  })

  it('section mode plays the current step\'s section, not the first one using the pattern', () => {
    const doc = sharedDoc('p2')
    expect(buildArrangement(doc, 'section', { sectionId: 'B', step: 0 }).map((a) => a.patternId)).toEqual(['p2', 'p3'])
    expect(buildArrangement(doc, 'section', null).map((a) => a.patternId)).toEqual(['p1', 'p2', 'p1'])
  })

  it('resolveStep keeps a valid hint, else finds the pattern in the hinted section, else anywhere', () => {
    expect(resolveStep(sharedDoc('p1'), { sectionId: 'A', step: 2 })).toEqual({ sectionId: 'A', step: 2 })
    expect(resolveStep(sharedDoc('p2'), { sectionId: 'B', step: 1 })).toEqual({ sectionId: 'B', step: 0 })
    expect(resolveStep(sharedDoc('p3'), { sectionId: 'A', step: 0 })).toEqual({ sectionId: 'B', step: 1 })
    expect(resolveStep(sharedDoc('p3'), { sectionId: 'gone', step: 0 })).toEqual({ sectionId: 'B', step: 1 })
    expect(resolveStep(sharedDoc('p9'), null)).toBeNull()
  })

  it('startRowFor starts at the current step, so a repeated pattern starts at the right one', () => {
    const doc = sharedDoc('p1')
    const arr = buildArrangement(doc, 'section', { sectionId: 'A', step: 2 })
    expect(startRowFor(doc, arr, { sectionId: 'A', step: 2 }, 3)).toBe(51)
    expect(startRowFor(doc, arr, null, 3)).toBe(3)
  })

  it('itemIndexAt finds the playing item, wrapping around the arrangement', () => {
    const doc = sharedDoc('p1')
    const arr = buildArrangement(doc, 'song')
    expect(itemIndexAt(doc, arr, 0)).toBe(0)
    expect(itemIndexAt(doc, arr, 50)).toBe(2)
    expect(itemIndexAt(doc, arr, 104 + 17)).toBe(1)
    expect(itemIndexAt(doc, [], 5)).toBe(-1)
  })
})

describe('neighbourSteps', () => {
  it('finds the song steps around the current one, across section borders', () => {
    const { prev, next } = neighbourSteps(sharedDoc('p1'), { sectionId: 'A', step: 2 })
    expect(prev).toMatchObject({ patternId: 'p2', sectionId: 'A', step: 1 })
    expect(next).toMatchObject({ patternId: 'p2', sectionId: 'B', step: 0 })
  })

  it('has no neighbour past the ends, and none for a pattern outside the song', () => {
    expect(neighbourSteps(sharedDoc('p1'), { sectionId: 'A', step: 0 }).prev).toBeNull()
    expect(neighbourSteps(sharedDoc('p3'), null).next).toBeNull()
    expect(neighbourSteps(sharedDoc('p9'), null)).toEqual({ prev: null, next: null })
  })
})
