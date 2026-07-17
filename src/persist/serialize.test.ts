import { describe, expect, it } from 'vitest'
import { createDefaultDoc, newModularInstrument, newTrack } from '../domain/factory'
import {
  CURRENT_SCHEMA_VERSION,
  deserializeSong,
  makeSongFile,
  migrate,
  serializeSong,
  type SongFile,
} from './serialize'

const META = { name: 'My Song', createdAt: '2026-07-12T10:00:00.000Z', modifiedAt: '2026-07-12T10:00:00.000Z' }

describe('song serialization', () => {
  it('round-trips a doc unchanged (serialize → deserialize is identity)', () => {
    const doc = createDefaultDoc()
    const file = makeSongFile(doc, META)
    const restored = deserializeSong(serializeSong(file))
    expect(restored).toEqual(file)
    expect(restored.doc).toEqual(doc)
  })

  it('stamps the current schema version', () => {
    const file = makeSongFile(createDefaultDoc(), META)
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('preserves note edits through a round-trip', () => {
    const doc = createDefaultDoc()
    const trackId = doc.entities.patterns[doc.patternId].trackIds[0]
    doc.entities.tracks[trackId].cells[3].note = 71
    const restored = deserializeSong(serializeSong(makeSongFile(doc, META)))
    expect(restored.doc.entities.tracks[trackId].cells[3].note).toBe(71)
  })

  it('rejects invalid JSON', () => {
    expect(() => deserializeSong('{ not json')).toThrow(/invalid JSON/)
  })

  it('rejects a file with no schemaVersion', () => {
    expect(() => migrate({ meta: META, doc: createDefaultDoc() })).toThrow(/schemaVersion/)
  })

  it('rejects a file from a newer, unsupported version', () => {
    const future: SongFile = { ...makeSongFile(createDefaultDoc(), META), schemaVersion: 999 }
    expect(() => migrate(future)).toThrow(/newer than this app supports/)
  })

  it('rejects a structurally broken doc', () => {
    expect(() => migrate({ schemaVersion: 1, meta: META })).toThrow(/doc\.entities/)
    expect(() => migrate({ schemaVersion: 1, doc: { entities: {} } })).toThrow(/meta\.name/)
  })

  it('accepts an already-current file via migrate', () => {
    const file = makeSongFile(createDefaultDoc(), META)
    expect(migrate(file)).toEqual(file)
  })

  it('round-trips a modular instrument (module graph survives save/load)', () => {
    const doc = createDefaultDoc()
    const inst = newModularInstrument('Patch')
    const trk = newTrack(inst.id, doc.entities.patterns[doc.patternId].length)
    doc.entities.instruments[inst.id] = inst
    doc.entities.tracks[trk.id] = trk
    doc.entities.patterns[doc.patternId].trackIds.push(trk.id)

    const restored = deserializeSong(serializeSong(makeSongFile(doc, META)))
    const back = restored.doc.entities.instruments[inst.id]
    expect(back).toEqual(inst)
    expect(back.kind).toBe('modular')
  })

  it('migrates old output.in connections to inL (post-stereo fix)', () => {
    const doc = createDefaultDoc()
    const inst = newModularInstrument('Patch')
    // Simulate an old connection targeting the old 'in' port on the output.
    for (const c of Object.values(inst.connections)) {
      if (inst.modules[c.to.moduleId]?.type === 'output') {
        c.to.port = 'in' // mutate the seeded connection
      }
    }
    doc.entities.instruments[inst.id] = inst
    const file = makeSongFile(doc, META)
    const restored = deserializeSong(serializeSong(file))
    const back = restored.doc.entities.instruments[inst.id]
    if (back.kind !== 'modular') throw new Error('expected modular')
    for (const c of Object.values(back.connections)) {
      if (back.modules[c.to.moduleId]?.type === 'output') {
        expect(c.to.port).toBe('inL')
      }
    }
  })

  // --- v2 → v3 migration ---

  it('migrates a v2 file: adds sections, sectionIds, volume, and noteOff', () => {
    const doc = createDefaultDoc()
    const v2: SongFile = {
      schemaVersion: 2,
      meta: { name: 'v2 song', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      doc: {
        entities: { ...doc.entities, sections: undefined as never, samples: doc.entities.samples },
        patternId: doc.patternId,
        sectionIds: undefined as never,
      },
    }
    // Strip sections/sectionIds to simulate a v2 file.
    const v2raw = JSON.parse(JSON.stringify(v2))
    delete v2raw.doc.entities.sections
    delete v2raw.doc.sectionIds

    const migrated = migrate(v2raw)
    expect(migrated.schemaVersion).toBe(3)
    // Should have a sections map.
    expect(migrated.doc.entities.sections).toBeTruthy()
    expect(Object.keys(migrated.doc.entities.sections).length).toBeGreaterThan(0)
    // Should have sectionIds.
    expect(migrated.doc.sectionIds.length).toBeGreaterThan(0)
    // First section should reference existing patterns.
    const firstSecId = migrated.doc.sectionIds[0]
    const firstSec = migrated.doc.entities.sections[firstSecId]
    expect(firstSec.patternIds.length).toBeGreaterThan(0)
  })

  it('migrates v2 cells: adds volume and noteOff fields', () => {
    const doc = createDefaultDoc()
    const v2: SongFile = {
      schemaVersion: 2,
      meta: { name: 'v2 song', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      doc: {
        entities: { ...doc.entities, sections: undefined as never, samples: doc.entities.samples },
        patternId: doc.patternId,
        sectionIds: undefined as never,
      },
    }
    const v2raw = JSON.parse(JSON.stringify(v2))
    delete v2raw.doc.entities.sections
    delete v2raw.doc.sectionIds

    // Remove new fields from cells to simulate v2.
    for (const track of Object.values(v2raw.doc.entities.tracks) as Array<Record<string, unknown>>) {
      if (Array.isArray(track.cells)) {
        track.cells = (track.cells as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
          note: c.note,
        }))
      }
    }

    const migrated = migrate(v2raw)
    // Check that cells now have volume and noteOff.
    const restoredTrack = Object.values(migrated.doc.entities.tracks)[0] as { cells: Array<{ volume: unknown; noteOff: unknown }> }
    expect(restoredTrack.cells[0].volume).toBeNull()
    expect(restoredTrack.cells[0].noteOff).toBe(false)
  })
})
