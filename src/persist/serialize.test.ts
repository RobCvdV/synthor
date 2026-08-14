import { describe, expect, it } from 'vitest'
import { buildDxAlgorithm, createDefaultDoc, newModularInstrument, newTrack } from '../domain/factory'
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

  it('round-trips dxop modules and algorithm wirings (v11)', () => {
    const doc = createDefaultDoc()
    const inst = newModularInstrument('FM Patch')
    const gateId = Object.values(inst.modules).find((m) => m.type === 'gate')!.id
    const { modules, connections } = buildDxAlgorithm(1, inst.outputId, gateId, { x: 0, y: 0 })
    for (const m of modules) inst.modules[m.id] = m
    for (const c of connections) inst.connections[c.id] = c
    doc.entities.instruments[inst.id] = inst

    const restored = deserializeSong(serializeSong(makeSongFile(doc, META)))
    expect(restored.doc.entities.instruments[inst.id]).toEqual(inst)
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
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

describe('migration v5→v6', () => {
  it('strips effect/effectValue from cells', () => {
    const v5 = {
      schemaVersion: 5,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {},
          tracks: {
            t1: {
              id: 't1', instrumentId: 'i1',
              cells: [
                { note: 60, volume: null, noteOff: false, effect: 0x108, effectValue: 0x08 },
                { note: null, volume: null, noteOff: false, effect: null, effectValue: null },
              ],
            },
          },
          patterns: { p1: { id: 'p1', name: 'p', length: 2, trackIds: ['t1'] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v5)
    const cells = (result.doc.entities.tracks as any).t1.cells
    expect(cells[0].effectLanes).toEqual({})
    expect(cells[0].effect).toBeUndefined()
    expect(cells[0].effectValue).toBeUndefined()
    expect(cells[0].note).toBe(60)
    expect(cells[1].effectLanes).toEqual({})
  })

  it('adds effectLanes array to tracks', () => {
    const v5 = {
      schemaVersion: 5,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {},
          tracks: {
            t1: {
              id: 't1', instrumentId: 'i1',
              cells: [{ note: 60, volume: null, noteOff: false, effect: null, effectValue: null }],
            },
          },
          patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: ['t1'] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v5)
    expect((result.doc.entities.tracks as any).t1.effectLanes).toEqual([])
  })

  it('converts effect1/effect2 modules to eff modules with names', () => {
    const v5 = {
      schemaVersion: 5,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {
            i1: {
              id: 'i1', kind: 'modular', name: 'Mod',
              modules: {
                m1: { id: 'm1', type: 'effect1', params: { cc: 10 }, pos: { x: 40, y: 640 } },
                m2: { id: 'm2', type: 'effect2', params: {}, pos: { x: 40, y: 840 } },
                m3: { id: 'm3', type: 'output', params: { gain: 1 }, pos: { x: 960, y: 160 } },
              },
              connections: {
                c1: { id: 'c1', from: { moduleId: 'm1', port: 'val' }, to: { moduleId: 'm3', port: 'inL' }, gain: 1 },
              },
              outputId: 'm3',
            },
          },
          tracks: {},
          patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: [] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v5)
    const mods: any[] = Object.values((result.doc.entities.instruments as any).i1.modules)
    const effMods = mods.filter((m: any) => m.type === 'eff')
    expect(effMods).toHaveLength(2)
    expect(effMods[0].name).toBe('Eff 01')
    expect(effMods[1].name).toBe('Eff 02')
    expect(mods.find((m: any) => m.id === 'm1')).toBeUndefined()
    expect(mods.find((m: any) => m.id === 'm2')).toBeUndefined()
  })

  it('remaps connection refs from old module ids to new eff ids', () => {
    const v5 = {
      schemaVersion: 5,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {
            i1: {
              id: 'i1', kind: 'modular', name: 'Mod',
              modules: {
                m1: { id: 'm1', type: 'effect1', params: { cc: 0 }, pos: { x: 40, y: 640 } },
                m3: { id: 'm3', type: 'output', params: { gain: 1 }, pos: { x: 960, y: 160 } },
              },
              connections: {
                c1: { id: 'c1', from: { moduleId: 'm1', port: 'val' }, to: { moduleId: 'm3', port: 'inL' }, gain: 1 },
              },
              outputId: 'm3',
            },
          },
          tracks: {},
          patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: [] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v5)
    const conns: any[] = Object.values((result.doc.entities.instruments as any).i1.connections)
    const c1 = conns[0]
    expect(c1.from.moduleId).not.toBe('m1')
    // The new module id should exist.
    const mods: any = (result.doc.entities.instruments as any).i1.modules
    expect(mods[c1.from.moduleId]).toBeDefined()
    expect(mods[c1.from.moduleId].type).toBe('eff')
  })

  it('preserves existing effectLanes when already present', () => {
    const v5 = {
      schemaVersion: 5,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {},
          tracks: {
            t1: {
              id: 't1', instrumentId: 'i1',
              effectLanes: [{ id: 'l1', type: 'panning' }],
              cells: [{ note: 60, volume: null, noteOff: false, effect: null, effectValue: null, effectLanes: { l1: 0.5 } }],
            },
          },
          patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: ['t1'] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v5)
    const track = (result.doc.entities.tracks as any).t1
    expect(track.effectLanes).toEqual([{ id: 'l1', type: 'panning' }])
    expect(track.cells[0].effectLanes).toEqual({ l1: 0.5 })
  })
})

describe('migration portaUp/portaDown → portamento', () => {
  it('converts portaUp lane type and remaps cell values', () => {
    const v6 = {
      schemaVersion: 6,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {},
          tracks: {
            t1: {
              id: 't1', instrumentId: 'i1',
              effectLanes: [{ id: 'l1', type: 'portaUp' }],
              cells: [
                { note: 60, volume: null, noteOff: false, effectLanes: { l1: 0.0 } },
                { note: 60, volume: null, noteOff: false, effectLanes: { l1: 1.0 } },
                { note: 60, volume: null, noteOff: false, effectLanes: { l1: 0.5 } },
                { note: 60, volume: null, noteOff: false, effectLanes: {} },
              ],
            },
          },
          patterns: { p1: { id: 'p1', name: 'p', length: 4, trackIds: ['t1'] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v6)
    const track = (result.doc.entities.tracks as any).t1
    expect(track.effectLanes).toEqual([{ id: 'l1', type: 'portamento' }])
    // portaUp: 0→0.5, 0.5→0.75, 1→1, unset→unset
    expect(track.cells[0].effectLanes.l1).toBeCloseTo(0.5)  // 0 → 0.5
    expect(track.cells[1].effectLanes.l1).toBeCloseTo(1.0)  // 1 → 1
    expect(track.cells[2].effectLanes.l1).toBeCloseTo(0.75) // 0.5 → 0.75
  })

  it('converts portaDown lane type and remaps cell values', () => {
    const v6 = {
      schemaVersion: 6,
      meta: META,
      doc: {
        patternId: 'p1',
        sectionIds: [],
        entities: {
          instruments: {},
          tracks: {
            t1: {
              id: 't1', instrumentId: 'i1',
              effectLanes: [{ id: 'l1', type: 'portaDown' }],
              cells: [
                { note: 60, volume: null, noteOff: false, effectLanes: { l1: 0.0 } },
                { note: 60, volume: null, noteOff: false, effectLanes: { l1: 1.0 } },
                { note: 60, volume: null, noteOff: false, effectLanes: { l1: 0.5 } },
              ],
            },
          },
          patterns: { p1: { id: 'p1', name: 'p', length: 3, trackIds: ['t1'] } },
          sections: {},
          samples: {},
        },
      },
    }
    const result = migrate(v6)
    const track = (result.doc.entities.tracks as any).t1
    expect(track.effectLanes).toEqual([{ id: 'l1', type: 'portamento' }])
    // portaDown: 0→0.5, 0.5→0.25, 1→0
    expect(track.cells[0].effectLanes.l1).toBeCloseTo(0.5)  // 0 → 0.5
    expect(track.cells[1].effectLanes.l1).toBeCloseTo(0.0)  // 1 → 0
    expect(track.cells[2].effectLanes.l1).toBeCloseTo(0.25) // 0.5 → 0.25
  })
})

describe('migration — eff inlet naming', () => {
  /** A minimal current-version file with one modular instrument. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeCurrent = (modules: Record<string, any>) => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: META,
    doc: {
      patternId: 'p1',
      sectionIds: [],
      entities: {
        instruments: {
          i1: {
            id: 'i1', kind: 'modular', name: 'Mod',
            modules: {
              ...modules,
              vol: { id: 'vol', type: 'volume', params: {}, pos: { x: 0, y: 0 } },
              out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
            },
            connections: {},
            outputId: 'out',
            channelId: 'master',
            pan: 0,
          },
        },
        tracks: {},
        patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: [] } },
        sections: {},
        samples: {},
        mixChannels: {
          master: { id: 'master', name: 'Master', kind: 'master', volume: 1, pan: 0, mute: false, solo: false, effects: [] },
        },
        mixerInstrumentOrder: ['i1'],
      },
    },
  })

  const effMods = (result: any) =>
    Object.values((result.doc.entities.instruments as any).i1.modules as Record<string, any>)
      .filter((m: any) => m.type === 'eff')
      .map((m: any) => m.name)

  it('backfills unique names on unnamed eff modules', () => {
    const result = migrate(makeCurrent({
      m1: { id: 'm1', type: 'eff', params: { cc: 0 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'eff', params: { cc: 0 }, pos: { x: 0, y: 0 } },
    }))
    expect(effMods(result)).toEqual(['Eff In 01', 'Eff In 02'])
  })

  it('renames duplicate names, keeping the first occurrence', () => {
    const result = migrate(makeCurrent({
      m1: { id: 'm1', type: 'eff', name: 'Filter Cutoff', params: { cc: 0 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'eff', name: 'Filter Cutoff', params: { cc: 0 }, pos: { x: 0, y: 0 } },
    }))
    expect(effMods(result)).toEqual(['Filter Cutoff', 'Eff In 01'])
  })

  it('skips taken names when backfilling unnamed modules', () => {
    const result = migrate(makeCurrent({
      m1: { id: 'm1', type: 'eff', name: 'Eff In 01', params: { cc: 0 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'eff', params: { cc: 0 }, pos: { x: 0, y: 0 } },
    }))
    expect(effMods(result)).toEqual(['Eff In 01', 'Eff In 02'])
  })

  it('leaves uniquely named eff modules untouched (identity preserved)', () => {
    const file = makeCurrent({
      m1: { id: 'm1', type: 'eff', name: 'Eff In 01', params: { cc: 0 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'eff', name: 'Eff In 02', params: { cc: 0 }, pos: { x: 0, y: 0 } },
    })
    expect(migrate(file)).toBe(file)
  })

  it('does not touch non-eff modules', () => {
    const result = migrate(makeCurrent({
      m1: { id: 'm1', type: 'osc', params: { waveform: 0 }, pos: { x: 0, y: 0 } },
    }))
    const mods = (result.doc.entities.instruments as any).i1.modules
    expect(mods.m1.name).toBeUndefined()
  })
})

describe('migration v8→v9 — delay/echo time to ticks', () => {
  /** A minimal v8 file with one modular instrument + one mix channel. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeV8 = (modules: Record<string, any>, channelEffects: any[] = []) => ({
    schemaVersion: 8,
    meta: META,
    doc: {
      patternId: 'p1',
      sectionIds: [],
      entities: {
        instruments: {
          i1: {
            id: 'i1', kind: 'modular', name: 'Mod',
            modules: {
              ...modules,
              vol: { id: 'vol', type: 'volume', params: {}, pos: { x: 0, y: 0 } },
              out: { id: 'out', type: 'output', params: { gain: 1 }, pos: { x: 0, y: 0 } },
            },
            connections: {},
            outputId: 'out',
            channelId: 'master',
            pan: 0,
          },
        },
        tracks: {},
        patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: [] } },
        sections: {},
        samples: {},
        mixChannels: {
          master: { id: 'master', name: 'Master', kind: 'master', volume: 1, pan: 0, mute: false, solo: false, effects: channelEffects },
        },
        mixerInstrumentOrder: ['i1'],
      },
    },
  })

  const moduleTime = (result: any, mid: string) =>
    (result.doc.entities.instruments as any).i1.modules[mid].params.time

  it('converts modular delay/echo module time from ms to ticks', () => {
    const result = migrate(makeV8({
      m1: { id: 'm1', type: 'delay', params: { bypass: 0, time: 150, mix: 0.5 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'echo', params: { bypass: 0, time: 300, feedback: 0.25, mix: 0.5 }, pos: { x: 0, y: 0 } },
    }))
    // 150 ms ≈ 1.2 ticks → 1.25; 300 ms ≈ 2.4 ticks → 2.5 (125 ms/row at default tempo).
    expect(moduleTime(result, 'm1')).toBe(1.25)
    expect(moduleTime(result, 'm2')).toBe(2.5)
  })

  it('quantizes to quarter ticks and clamps to 0.25..16', () => {
    const result = migrate(makeV8({
      m1: { id: 'm1', type: 'delay', params: { time: 5000, mix: 0.5 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'delay', params: { time: 1, mix: 0.5 }, pos: { x: 0, y: 0 } },
    }))
    expect(moduleTime(result, 'm1')).toBe(16)
    expect(moduleTime(result, 'm2')).toBe(0.25)
  })

  it('converts mix-channel effect times too', () => {
    const result = migrate(makeV8({}, [
      { id: 'fx1', type: 'echo', params: { time: 250, feedback: 0.3, mix: 0.4 } },
      { id: 'fx2', type: 'filter', params: { cutoff: 1000 } },
    ]))
    const fx = (result.doc.entities.mixChannels as any).master.effects
    expect(fx[0].params.time).toBe(2)
    expect(fx[1].params).toEqual({ cutoff: 1000 })
  })

  it('leaves other modules and non-time params untouched', () => {
    const result = migrate(makeV8({
      m1: { id: 'm1', type: 'delay', params: { time: 150, mix: 0.8 }, pos: { x: 0, y: 0 } },
      m2: { id: 'm2', type: 'reverb', params: { roomSize: 0.6 }, pos: { x: 0, y: 0 } },
    }))
    expect(moduleTime(result, 'm1')).toBe(1.25)
    expect((result.doc.entities.instruments as any).i1.modules.m1.params.mix).toBe(0.8)
    expect((result.doc.entities.instruments as any).i1.modules.m2.params.roomSize).toBe(0.6)
  })

  it('stamps v9 even when nothing changes', () => {
    const result = migrate(makeV8({}))
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})

describe('migration v9→v10 — osc instruments become modular synths', () => {
  /** A minimal v9 file with one osc instrument + one track pointing at it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeV9 = (instruments: Record<string, any>) => ({
    schemaVersion: 9,
    meta: META,
    doc: {
      patternId: 'p1',
      sectionIds: [],
      entities: {
        instruments,
        tracks: {
          t1: { id: 't1', instrumentId: 'i1', cells: [{ note: 60, volume: null, noteOff: false, hold: false, effectLanes: {} }], effectLanes: [] },
        },
        patterns: { p1: { id: 'p1', name: 'p', length: 1, trackIds: ['t1'] } },
        sections: {},
        samples: {},
        mixChannels: {
          master: { id: 'master', name: 'Master', kind: 'master', volume: 1, pan: 0, mute: false, solo: false, effects: [] },
        },
        mixerInstrumentOrder: ['i1'],
      },
    },
  })

  const oscInst = {
    id: 'i1', kind: 'osc', name: 'Old Saw', params: { gain: 0.6 },
    effectSettings: { portamento: 12 }, channelId: 'master', pan: -0.3, midiChannel: 4,
  }

  it('converts an osc instrument to a minimal modular synth in place', () => {
    const result = migrate(makeV9({ i1: oscInst }))
    const inst: any = (result.doc.entities.instruments as any).i1
    expect(inst.kind).toBe('modular')
    expect(inst.id).toBe('i1')
    expect(inst.name).toBe('Old Saw')
    expect(inst.channelId).toBe('master')
    expect(inst.pan).toBe(-0.3)
    expect(inst.midiChannel).toBe(4)
    expect(inst.effectSettings).toEqual({ portamento: 12 })
    // The track keeps pointing at the same id.
    expect((result.doc.entities.tracks as any).t1.instrumentId).toBe('i1')
    // The old gain lands on the output module.
    const mods: any = inst.modules
    const out = Object.values(mods).find((m: any) => m.type === 'output') as any
    expect(out.params.gain).toBe(0.6)
  })

  it('wires the classic saw voice: note→osc, gate→adsr, env→gain, gain→output', () => {
    const result = migrate(makeV9({ i1: oscInst }))
    const inst: any = (result.doc.entities.instruments as any).i1
    const mods: any = inst.modules
    const byType = (t: string) => Object.values(mods).filter((m: any) => m.type === t)
    expect(byType('note')).toHaveLength(1)
    expect(byType('gate')).toHaveLength(1)
    expect(byType('osc')).toHaveLength(1)
    expect(byType('adsr')).toHaveLength(1)
    expect(byType('gain')).toHaveLength(1)
    expect(byType('output')).toHaveLength(1)
    expect(inst.outputId).toBe((byType('output')[0] as any).id)
    const conns: any = inst.connections
    const pairs = Object.values(conns).map((c: any) => `${c.from.port}→${(mods[c.to.moduleId] as any).type}.${c.to.port}`)
    expect(pairs).toContain('freq→osc.freq')
    expect(pairs).toContain('out→gain.in')
    expect(pairs).toContain('gate→adsr.gate')
    expect(pairs).toContain('env→gain.mod')
    expect(pairs).toContain('out→output.inL')
  })

  it('leaves non-osc instruments untouched and stamps v10', () => {
    const synth = newModularInstrument('Synth')
    synth.id = 'i1'
    const result = migrate(makeV9({ i1: synth }))
    expect((result.doc.entities.instruments as any).i1).toBe(synth)
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('stamps v10 even when nothing changes', () => {
    const result = migrate(makeV9({}))
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})
