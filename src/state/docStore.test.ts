import { beforeEach, describe, expect, it } from 'vitest'
import { useDocStore } from './docStore'
import { cloneInstrument, createDefaultDoc, newModularInstrument } from '../domain/factory'
import type { ModularInstrument } from '../domain/types'

function firstTrackId(): string {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId].trackIds[0]
}

describe('docStore', () => {
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [] })
  })

  it('edits a cell note', () => {
    const trk = firstTrackId()
    useDocStore.getState().setCellNote(trk, 1, 62)
    expect(useDocStore.getState().doc.entities.tracks[trk].cells[1].note).toBe(62)
  })

  it('undoes and redoes an edit', () => {
    const trk = firstTrackId()
    const before = useDocStore.getState().doc.entities.tracks[trk].cells[1].note
    useDocStore.getState().setCellNote(trk, 1, 62)
    useDocStore.getState().undo()
    expect(useDocStore.getState().doc.entities.tracks[trk].cells[1].note).toBe(before)
    useDocStore.getState().redo()
    expect(useDocStore.getState().doc.entities.tracks[trk].cells[1].note).toBe(62)
  })

  it('does not record a no-op edit in history', () => {
    const trk = firstTrackId()
    const existing = useDocStore.getState().doc.entities.tracks[trk].cells[0].note
    useDocStore.getState().setCellNote(trk, 0, existing) // same value
    expect(useDocStore.getState().past).toHaveLength(0)
  })

  it('clears the redo stack on a fresh edit', () => {
    const trk = firstTrackId()
    useDocStore.getState().setCellNote(trk, 1, 62)
    useDocStore.getState().undo()
    expect(useDocStore.getState().future).toHaveLength(1)
    useDocStore.getState().setCellNote(trk, 2, 64)
    expect(useDocStore.getState().future).toHaveLength(0)
  })
})

function trackIds(): string[] {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId].trackIds
}

describe('docStore track operations', () => {
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [], trackClipboard: null, mutedTracks: {} })
  })

  it('toggles a track mute without touching undo history', () => {
    const [first] = trackIds()
    useDocStore.getState().toggleMute(first)
    expect(useDocStore.getState().mutedTracks[first]).toBe(true)
    expect(useDocStore.getState().past).toHaveLength(0) // mute is not undoable
    useDocStore.getState().toggleMute(first)
    expect(useDocStore.getState().mutedTracks[first]).toBe(false)
  })

  it('inserts a new empty track at an index, inheriting the given instrument', () => {
    const [first] = trackIds()
    const instId = useDocStore.getState().doc.entities.tracks[first].instrumentId
    useDocStore.getState().addTrack(1, instId)
    expect(trackIds()).toHaveLength(3)
    const newId = trackIds()[1]
    const cells = useDocStore.getState().doc.entities.tracks[newId].cells
    expect(cells.every((c) => c.note === null)).toBe(true)
    expect(useDocStore.getState().doc.entities.tracks[newId].instrumentId).toBe(instId)
  })

  it('removes a track but keeps its (now first-class) instrument', () => {
    const [first] = trackIds()
    const instId = useDocStore.getState().doc.entities.tracks[first].instrumentId
    useDocStore.getState().removeTrack(first)
    expect(trackIds()).toHaveLength(1)
    expect(useDocStore.getState().doc.entities.tracks[first]).toBeUndefined()
    // Instruments are shared entities now — removing a track never deletes one.
    expect(useDocStore.getState().doc.entities.instruments[instId]).toBeDefined()
  })

  it('duplicates a track sharing the same instrument (reference reuse)', () => {
    const [first] = trackIds()
    const srcInst = useDocStore.getState().doc.entities.tracks[first].instrumentId
    useDocStore.getState().duplicateTrack(first, 1)
    const dupInst = useDocStore.getState().doc.entities.tracks[trackIds()[1]].instrumentId
    expect(dupInst).toBe(srcInst)
  })

  it('moves a track', () => {
    const [a, b] = trackIds()
    useDocStore.getState().moveTrack(0, 1)
    expect(trackIds()).toEqual([b, a])
  })

  it('copies and pastes a track as an independent clone', () => {
    const [first] = trackIds()
    useDocStore.getState().setCellNote(first, 2, 99)
    useDocStore.getState().copyTrack(first)
    useDocStore.getState().pasteTrack(1)
    const pastedId = trackIds()[1]
    expect(pastedId).not.toBe(first)
    expect(useDocStore.getState().doc.entities.tracks[pastedId].cells[2].note).toBe(99)
    // Independent instrument.
    const srcInst = useDocStore.getState().doc.entities.tracks[first].instrumentId
    const dstInst = useDocStore.getState().doc.entities.tracks[pastedId].instrumentId
    expect(dstInst).not.toBe(srcInst)
  })

  it('duplicates a track', () => {
    const [first] = trackIds()
    useDocStore.getState().setCellNote(first, 0, 55)
    useDocStore.getState().duplicateTrack(first, 1)
    const dupId = trackIds()[1]
    expect(useDocStore.getState().doc.entities.tracks[dupId].cells[0].note).toBe(55)
  })

  it('shifts a track up and down with wrap-around', () => {
    const [first] = trackIds()
    // Put a distinctive note at row 0.
    useDocStore.getState().setCellNote(first, 0, 77)
    const noteAt = (row: number) => useDocStore.getState().doc.entities.tracks[first].cells[row].note
    const len = useDocStore.getState().doc.entities.patterns[useDocStore.getState().doc.patternId].length

    useDocStore.getState().shiftTrack(first, 'up') // row 0 wraps to the bottom
    expect(noteAt(0)).toBeNull()
    expect(noteAt(len - 1)).toBe(77)

    useDocStore.getState().shiftTrack(first, 'down') // back to the top
    expect(noteAt(0)).toBe(77)
  })

  it('undoes a track insert', () => {
    const [first] = trackIds()
    const instId = useDocStore.getState().doc.entities.tracks[first].instrumentId
    useDocStore.getState().addTrack(2, instId)
    expect(trackIds()).toHaveLength(3)
    useDocStore.getState().undo()
    expect(trackIds()).toHaveLength(2)
  })
})

function instruments() {
  return useDocStore.getState().doc.entities.instruments
}
function asModular(id: string): ModularInstrument {
  const inst = instruments()[id]
  if (inst.kind !== 'modular') throw new Error('not modular')
  return inst
}

describe('docStore instrument operations', () => {
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [], trackClipboard: null, mutedTracks: {} })
  })

  it('adds a modular instrument seeded with a playable patch', () => {
    const id = useDocStore.getState().addInstrument('modular')
    const inst = asModular(id)
    const types = Object.values(inst.modules).map((m) => m.type).sort()
    expect(types).toContain('osc')
    expect(types).toContain('output')
    expect(inst.modules[inst.outputId].type).toBe('output')
  })

  it('renames an instrument', () => {
    const id = useDocStore.getState().addInstrument('osc')
    useDocStore.getState().renameInstrument(id, 'Bass')
    expect(instruments()[id].name).toBe('Bass')
  })

  it('blocks deleting an instrument still used by a track, allows it once free', () => {
    const [first] = trackIds()
    const instId = useDocStore.getState().doc.entities.tracks[first].instrumentId
    useDocStore.getState().removeInstrument(instId)
    expect(instruments()[instId]).toBeDefined() // still in use → kept
    const spare = useDocStore.getState().addInstrument('osc')
    useDocStore.getState().setTrackInstrument(first, spare)
    useDocStore.getState().removeInstrument(instId) // now orphaned
    expect(instruments()[instId]).toBeUndefined()
  })

  it('points a track at another instrument', () => {
    const [first] = trackIds()
    const id = useDocStore.getState().addInstrument('modular')
    useDocStore.getState().setTrackInstrument(first, id)
    expect(useDocStore.getState().doc.entities.tracks[first].instrumentId).toBe(id)
  })
})

describe('docStore modular graph operations', () => {
  let instId: string
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [], trackClipboard: null, mutedTracks: {} })
    instId = useDocStore.getState().addInstrument('modular')
  })

  it('adds a module, rejects singletons, and is undoable', () => {
    const before = Object.keys(asModular(instId).modules).length
    useDocStore.getState().addModule(instId, 'osc', { x: 0, y: 0 })
    expect(Object.keys(asModular(instId).modules).length).toBe(before + 1)
    useDocStore.getState().addModule(instId, 'note', { x: 0, y: 0 }) // singleton
    expect(Object.keys(asModular(instId).modules).length).toBe(before + 1)
    useDocStore.getState().undo() // undo the osc add
    expect(Object.keys(asModular(instId).modules).length).toBe(before)
  })

  it('removes a module and drops its connections', () => {
    const oscId = Object.values(asModular(instId).modules).find((m) => m.type === 'osc')!.id
    const touching = () =>
      Object.values(asModular(instId).connections).filter(
        (c) => c.from.moduleId === oscId || c.to.moduleId === oscId,
      ).length
    expect(touching()).toBeGreaterThan(0)
    useDocStore.getState().removeModule(instId, oscId)
    expect(asModular(instId).modules[oscId]).toBeUndefined()
    expect(touching()).toBe(0)
  })

  it('replaces an existing cord into the same inlet', () => {
    const mods = Object.values(asModular(instId).modules)
    const filterId = mods.find((m) => m.type === 'filter')!.id
    const noteId = mods.find((m) => m.type === 'note')!.id
    const feedersIntoFilterIn = () =>
      Object.values(asModular(instId).connections).filter(
        (c) => c.to.moduleId === filterId && c.to.port === 'in',
      )
    expect(feedersIntoFilterIn().length).toBe(1) // osc → filter.in from seed
    useDocStore.getState().addConnection(
      instId,
      { moduleId: noteId, port: 'freq' },
      { moduleId: filterId, port: 'in' },
    )
    expect(feedersIntoFilterIn().length).toBe(1) // replaced, not added
    expect(feedersIntoFilterIn()[0].from.moduleId).toBe(noteId)
  })

  it('rejects a connection that would form a cycle', () => {
    const mods = Object.values(asModular(instId).modules)
    const oscId = mods.find((m) => m.type === 'osc')!.id
    const gainId = mods.find((m) => m.type === 'gain')!.id
    // gain already feeds (via filter chain) into osc? No — osc → filter → gain.
    // So gain.out → osc.freq would close a loop and must be rejected.
    const before = Object.keys(asModular(instId).connections).length
    useDocStore.getState().addConnection(
      instId,
      { moduleId: gainId, port: 'out' },
      { moduleId: oscId, port: 'freq' },
    )
    expect(Object.keys(asModular(instId).connections).length).toBe(before)
  })

  it('sets a connection gain', () => {
    const conId = Object.keys(asModular(instId).connections)[0]
    useDocStore.getState().setConnectionGain(instId, conId, 0.25)
    expect(asModular(instId).connections[conId].gain).toBe(0.25)
  })
})

describe('cloneInstrument', () => {
  it('produces fully fresh module and connection ids', () => {
    const src = newModularInstrument('Src')
    const copy = cloneInstrument(src, 'Copy') as ModularInstrument
    const srcMods = new Set(Object.keys(src.modules))
    const copyMods = Object.keys(copy.modules)
    expect(copyMods).toHaveLength(srcMods.size)
    expect(copyMods.some((id) => srcMods.has(id))).toBe(false)
    // outputId is remapped and still points at the output module.
    expect(copy.modules[copy.outputId].type).toBe('output')
    // Connections reference only cloned module ids.
    for (const c of Object.values(copy.connections)) {
      expect(copy.modules[c.from.moduleId]).toBeDefined()
      expect(copy.modules[c.to.moduleId]).toBeDefined()
    }
  })
})
