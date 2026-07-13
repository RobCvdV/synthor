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
})
