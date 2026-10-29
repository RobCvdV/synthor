import { describe, expect, it } from 'vitest'
import { createDefaultDoc } from '../domain/factory'
import { defaultParams } from '../domain/moduleDefs'
import { MASTER_CHANNEL_ID, type ModularInstrument } from '../domain/types'
import { completeDoc } from './completeDoc'

const META = { name: 'Song', createdAt: '', modifiedAt: '' }
const file = (doc: unknown) => JSON.parse(JSON.stringify({ schemaVersion: 16, meta: META, doc }))

describe('completeDoc', () => {
  it('leaves a complete document as it is', () => {
    const doc = createDefaultDoc()
    expect(completeDoc(file(doc)).doc).toEqual(doc)
  })

  it('completes a synth: params, output, cords, settings', () => {
    const raw = file(createDefaultDoc())
    const synth = Object.values(raw.doc.entities.instruments).find((i: any) => i.kind === 'modular') as any
    const osc = Object.values(synth.modules).find((m: any) => m.type === 'osc') as any
    osc.params = { waveform: 2, detune: 'x' }
    delete osc.pos
    synth.modules.alien = { id: 'alien', type: 'theremin', params: {}, pos: { x: 0, y: 0 } }
    synth.connections.dangling = { id: 'dangling', from: { moduleId: 'gone', port: 'out' }, to: { moduleId: osc.id, port: 'freq' }, gain: 1 }
    synth.connections.badPort = { id: 'badPort', from: { moduleId: osc.id, port: 'nope' }, to: { moduleId: synth.outputId, port: 'inL' } }
    const firstCord = Object.values(synth.connections)[0] as any
    delete firstCord.gain
    delete synth.outputId
    delete synth.effectSettings
    delete synth.pan

    const out = completeDoc(raw).doc.entities.instruments[synth.id] as ModularInstrument
    expect(out.modules[osc.id].params).toEqual({ ...defaultParams('osc'), waveform: 2 })
    expect(out.modules[osc.id].pos).toEqual({ x: 0, y: 0 })
    expect(out.modules.alien).toBeUndefined()
    expect(out.connections.dangling).toBeUndefined()
    expect(out.connections.badPort).toBeUndefined()
    expect(out.connections[firstCord.id].gain).toBe(1)
    expect(out.modules[out.outputId].type).toBe('output')
    expect(out.effectSettings).toMatchObject({ portamento: 4 })
    expect(out.pan).toBe(0)
  })

  it('gives a synth without an output module a new one', () => {
    const raw = file(createDefaultDoc())
    const synth = Object.values(raw.doc.entities.instruments).find((i: any) => i.kind === 'modular') as any
    delete synth.modules[synth.outputId]
    const out = completeDoc(raw).doc.entities.instruments[synth.id] as ModularInstrument
    expect(out.modules[out.outputId]).toMatchObject({ type: 'output', params: defaultParams('output') })
  })

  it('completes drum kit slots, including the pre-v8 shape, and sorts them', () => {
    const raw = file(createDefaultDoc())
    const kit = Object.values(raw.doc.entities.instruments).find((i: any) => i.kind === 'drumkit') as any
    kit.slots = [
      { id: 'b', note: 40, sampleId: 'smp' },
      { id: 'a', note: 36, instrumentId: 'x', pitchOffset: 2, gain: 0.5 },
      { id: 'junk' },
    ]
    delete kit.keyLo
    delete kit.params
    const out = completeDoc(raw).doc.entities.instruments[kit.id]
    expect(out.slots).toEqual([
      { id: 'a', note: 36, sampleId: null, instrumentId: 'x', baseNote: 62, volume: 0.5, pan: 0 },
      { id: 'b', note: 40, sampleId: 'smp', instrumentId: null, baseNote: 60, volume: 1, pan: 0 },
    ])
    expect(out).toMatchObject({ keyLo: 36, params: { gain: 1 } })
  })

  it('fits cells to their pattern and fills in cell fields', () => {
    const raw = file(createDefaultDoc())
    const pattern = Object.values(raw.doc.entities.patterns)[0] as any
    const track = raw.doc.entities.tracks[pattern.trackIds[0]]
    track.cells = [{ note: 60 }, { volume: 0.5, effectLanes: { l: 0.2 } }]
    delete track.effectLanes
    pattern.trackIds.push('missing-track')

    const out = completeDoc(raw).doc.entities
    const cells = out.tracks[track.id].cells
    expect(cells).toHaveLength(pattern.length)
    expect(cells[0]).toEqual({ note: 60, volume: null, noteOff: false, hold: false, effectLanes: {} })
    expect(cells[1]).toEqual({ note: null, volume: 0.5, noteOff: false, hold: false, effectLanes: { l: 0.2 } })
    expect(out.tracks[track.id].effectLanes).toEqual([])
    expect(out.patterns[pattern.id].trackIds).toEqual([track.id])
  })

  it('keeps tracks whose instrument is gone, so their notes survive', () => {
    const raw = file(createDefaultDoc())
    const track = Object.values(raw.doc.entities.tracks)[0] as any
    delete raw.doc.entities.instruments[track.instrumentId]
    const out = completeDoc(raw).doc.entities
    expect(out.tracks[track.id].cells.some((c: any) => c.note !== null)).toBe(true)
    expect(out.mixerInstrumentOrder).not.toContain(track.instrumentId)
  })

  it('restores the master channel and completes channels and their effects', () => {
    const raw = file(createDefaultDoc())
    delete raw.doc.entities.mixChannels[MASTER_CHANNEL_ID]
    raw.doc.entities.mixChannels.sub = { name: 'Drums', effects: [{ id: 'f', type: 'filter', params: { cutoff: 500 } }, { id: 'x', type: 'flanger', params: {} }] }
    const out = completeDoc(raw).doc.entities.mixChannels
    expect(out[MASTER_CHANNEL_ID]).toMatchObject({ kind: 'master', volume: 1 })
    expect(out.sub).toMatchObject({ id: 'sub', kind: 'sub', volume: 1, pan: 0, mute: false, solo: false })
    expect(out.sub.effects).toEqual([{ id: 'f', type: 'filter', params: { ...defaultParams('filter'), cutoff: 500 } }])
  })

  it('drops references to sections and patterns that are gone, and fills in missing maps', () => {
    const raw = file(createDefaultDoc())
    const section = Object.values(raw.doc.entities.sections)[0] as any
    section.patternIds.push('gone')
    raw.doc.sectionIds.push('gone')
    delete raw.doc.entities.samples
    const out = completeDoc(raw).doc
    expect(out.entities.sections[section.id].patternIds).not.toContain('gone')
    expect(out.sectionIds).toEqual([section.id])
    expect(out.entities.samples).toEqual({})
  })

  it('keeps game settings that name what the song holds, by id or name', () => {
    const raw = file(createDefaultDoc())
    const section = Object.values(raw.doc.entities.sections)[0] as any
    const pattern = Object.values(raw.doc.entities.patterns)[0] as any
    const inst = Object.values(raw.doc.entities.instruments)[0] as any
    // an arranged section, a pattern, and a section that isn't arranged
    raw.doc.entities.sections.loose = { id: 'loose', name: 'Loose', patternIds: [pattern.id] }
    raw.doc.game = {
      song: { start: 'x', sections: [{ cue: section.name }, { cue: pattern.id }, { cue: 'Loose' }] },
      moods: { menu: { cue: section.id } },
      stingers: { a: { instrument: inst.name, notes: [60] }, b: { instrument: inst.id, notes: [60] } },
    }
    const game = completeDoc(raw).doc.game
    expect(game.song.sections.map((s: any) => s.cue)).toEqual([section.name, pattern.id])
    expect(game.song.start).toBe(section.name)
    expect(game.moods.menu.cue).toBe(section.id)
    expect(Object.keys(game.stingers)).toEqual(['a', 'b'])
  })

  it('drops game settings that are not an object', () => {
    const raw = file(createDefaultDoc())
    raw.doc.game = 'x'
    expect(completeDoc(raw).doc).not.toHaveProperty('game')
  })
})
