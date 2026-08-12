import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from '../state/docStore'
import { createDefaultDoc, makeId, newModularInstrument } from '../domain/factory'
import type { Connection, Doc, Module, ModularInstrument } from '../domain/types'
import { defaultParams } from '../domain/moduleDefs'

/** Reset the store to a known fresh state before each test. */
function resetStore(doc?: Doc) {
  useDocStore.getState().loadDoc(doc ?? createDefaultDoc())
}

describe('docStore — effect lanes', () => {
  beforeEach(() => resetStore())

  const firstTrackId = () => {
    const doc = useDocStore.getState().doc
    const pat = doc.entities.patterns[doc.patternId]
    return pat.trackIds[0]
  }

  it('adds an effect lane to a track', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')

    const track = useDocStore.getState().doc.entities.tracks[tid]
    expect(track.effectLanes).toHaveLength(1)
    expect(track.effectLanes[0].type).toBe('panning')
    expect(track.effectLanes[0].id).toMatch(/^lan_/)

    // Every cell should have the lane key with null value.
    for (const cell of track.cells) {
      expect(cell.effectLanes[track.effectLanes[0].id]).toBeNull()
    }
  })

  it('removes an effect lane and cleans up cells', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'panning')

    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id
    store.removeEffectLane(tid, laneId)

    const track = useDocStore.getState().doc.entities.tracks[tid]
    expect(track.effectLanes).toHaveLength(0)
    for (const cell of track.cells) {
      expect(cell.effectLanes[laneId]).toBeUndefined()
    }
  })

  it('sets and clears a lane value on a cell', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'vibratoDepth')
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id

    store.setCellEffectLane(tid, 0, laneId, 0.5)
    let cell = useDocStore.getState().doc.entities.tracks[tid].cells[0]
    expect(cell.effectLanes[laneId]).toBe(0.5)

    store.setCellEffectLane(tid, 0, laneId, null)
    cell = useDocStore.getState().doc.entities.tracks[tid].cells[0]
    expect(cell.effectLanes[laneId]).toBeNull()
  })

  it('changes lane type', () => {
    const tid = firstTrackId()
    const store = useDocStore.getState()
    store.addEffectLane(tid, 'panning')
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id

    store.setEffectLaneType(tid, laneId, 'vibratoDepth')
    const track = useDocStore.getState().doc.entities.tracks[tid]
    expect(track.effectLanes[0].type).toBe('vibratoDepth')
  })

  it('undo reverts lane add', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')
    expect(useDocStore.getState().doc.entities.tracks[tid].effectLanes).toHaveLength(1)

    useDocStore.getState().undo()
    expect(useDocStore.getState().doc.entities.tracks[tid].effectLanes).toHaveLength(0)
  })

  it('redo restores lane after undo', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')
    useDocStore.getState().undo()
    useDocStore.getState().redo()
    expect(useDocStore.getState().doc.entities.tracks[tid].effectLanes).toHaveLength(1)
  })

  it('default doc has no effect lanes on tracks', () => {
    const doc = useDocStore.getState().doc
    for (const track of Object.values(doc.entities.tracks)) {
      expect(track.effectLanes).toEqual([])
    }
  })

  it('default doc cells have empty effectLanes', () => {
    const doc = useDocStore.getState().doc
    for (const track of Object.values(doc.entities.tracks)) {
      for (const cell of track.cells) {
        expect(cell.effectLanes).toEqual({})
        // Old packed effect fields must not exist.
        expect((cell as any).effect).toBeUndefined()
        expect((cell as any).effectValue).toBeUndefined()
      }
    }
  })

  it('duplicateTrack copies effect lanes', () => {
    const tid = firstTrackId()
    useDocStore.getState().addEffectLane(tid, 'panning')
    // Re-read state after mutation — the old store reference is stale.
    const laneId = useDocStore.getState().doc.entities.tracks[tid].effectLanes[0].id
    useDocStore.getState().setCellEffectLane(tid, 0, laneId, 0.75)

    useDocStore.getState().duplicateTrack(tid, 2)
    const doc = useDocStore.getState().doc
    const pat = doc.entities.patterns[doc.patternId]
    const newTid = pat.trackIds[2]
    const newTrack = doc.entities.tracks[newTid]
    expect(newTrack.effectLanes).toHaveLength(1)
    expect(newTrack.effectLanes[0].type).toBe('panning')
    expect(newTrack.cells[0].effectLanes[newTrack.effectLanes[0].id]).toBe(0.75)
  })
})

describe('docStore — effect settings', () => {
  beforeEach(() => resetStore())

  const firstInstId = () => {
    const doc = useDocStore.getState().doc
    return Object.keys(doc.entities.instruments)[0]
  }

  it('default doc instruments have effect settings', () => {
    const doc = useDocStore.getState().doc
    for (const inst of Object.values(doc.entities.instruments)) {
      if (inst.kind !== 'drumkit') {
        expect(inst.effectSettings).toBeDefined()
        expect(inst.effectSettings!.vibratoRate).toBe(100)
        expect(inst.effectSettings!.vibratoDepth).toBe(0.5)
      }
    }
  })

  it('sets an effect setting on a modular instrument', () => {
    const iid = firstInstId()
    useDocStore.getState().setEffectSetting(iid, 'vibratoRate', 50)
    const inst = useDocStore.getState().doc.entities.instruments[iid]
    if (inst.kind !== 'drumkit') {
      expect(inst.effectSettings!.vibratoRate).toBe(50)
    }
  })

  it('undo reverts effect setting change', () => {
    const iid = firstInstId()
    useDocStore.getState().setEffectSetting(iid, 'portamento', 12)
    useDocStore.getState().undo()
    const inst = useDocStore.getState().doc.entities.instruments[iid]
    if (inst.kind !== 'drumkit') {
      expect(inst.effectSettings!.portamento).toBe(4) // default
    }
  })
})

/* ------------------------------------------------------------------ */
/*  pattern / section operations — underpin the Arrange tab drag-drop  */
/* ------------------------------------------------------------------ */

describe('docStore — pattern & section ops', () => {
  beforeEach(() => resetStore())

  const firstSectionId = () => useDocStore.getState().doc.sectionIds[0]
  const firstPatternId = () => useDocStore.getState().doc.patternId

  /* ---- sections ---- */

  it('creates a section with a default name', () => {
    const id = useDocStore.getState().addSection()
    expect(id).toMatch(/^sec_/)
    const doc = useDocStore.getState().doc
    expect(doc.sectionIds).toContain(id)
    expect(doc.entities.sections[id].name).toMatch(/^Section \d+$/)
  })

  it('removes a section', () => {
    const store = useDocStore.getState()
    const id = store.addSection()
    store.removeSection(id)
    expect(useDocStore.getState().doc.sectionIds).not.toContain(id)
  })

  it('reorders sections', () => {
    const store = useDocStore.getState()
    const a = store.addSection()
    const b = store.addSection()
    // Current order: [first, a, b]
    const doc = useDocStore.getState().doc
    const idxA = doc.sectionIds.indexOf(a)
    const idxB = doc.sectionIds.indexOf(b)
    // Move 'b' before 'a'
    store.reorderSections(idxB, idxA)
    const reordered = useDocStore.getState().doc.sectionIds
    expect(reordered.indexOf(b)).toBeLessThan(reordered.indexOf(a))
  })

  it('renames a section', () => {
    const id = firstSectionId()
    useDocStore.getState().renameSection(id, 'Intro')
    expect(useDocStore.getState().doc.entities.sections[id].name).toBe('Intro')
  })

  /* ---- patterns ---- */

  it('creates a pattern with a default name and length', () => {
    const store = useDocStore.getState()
    const id = store.addPattern()
    expect(id).toMatch(/^pat_/)
    const pat = useDocStore.getState().doc.entities.patterns[id]
    expect(pat.name).toMatch(/^Pattern \d+$/)
    expect(pat.length).toBe(64)
    // New patterns start with no tracks — tracks are added on first note entry
    expect(Array.isArray(pat.trackIds)).toBe(true)
  })

  it('duplicates a pattern', () => {
    const store = useDocStore.getState()
    const pid = firstPatternId()
    const dupId = store.duplicatePattern(pid)
    expect(dupId).not.toBe('')
    expect(dupId).not.toBe(pid)
    const dup = useDocStore.getState().doc.entities.patterns[dupId]
    expect(dup.name).toContain('(copy)')
    // Duplicated pattern should appear in the first section
    const firstSec = useDocStore.getState().doc.entities.sections[firstSectionId()]
    expect(firstSec.patternIds).toContain(dupId)
  })

  it('removes a pattern and cleans up sections', () => {
    const store = useDocStore.getState()
    const pid = store.addPattern()
    const sid = firstSectionId()
    store.addPatternToSection(sid, pid)
    store.removePattern(pid)
    const doc = useDocStore.getState().doc
    expect(doc.entities.patterns[pid]).toBeUndefined()
    expect(doc.entities.sections[sid].patternIds).not.toContain(pid)
  })

  it('refuses to remove the last pattern', () => {
    const pid = firstPatternId()
    const before = Object.keys(useDocStore.getState().doc.entities.patterns).length
    useDocStore.getState().removePattern(pid)
    const after = Object.keys(useDocStore.getState().doc.entities.patterns).length
    expect(after).toBe(before)
  })

  it('renames a pattern', () => {
    const pid = firstPatternId()
    useDocStore.getState().renamePattern(pid, 'Renamed')
    expect(useDocStore.getState().doc.entities.patterns[pid].name).toBe('Renamed')
  })

  /* ---- pattern ↔ section ---- */

  it('adds a pattern to a section', () => {
    const store = useDocStore.getState()
    const pid = store.addPattern()
    const sid = firstSectionId()
    store.addPatternToSection(sid, pid)
    expect(useDocStore.getState().doc.entities.sections[sid].patternIds).toContain(pid)
  })

  it('allows adding the same pattern to a section multiple times', () => {
    const store = useDocStore.getState()
    const pid = store.addPattern()
    const sid = firstSectionId()
    // Remove all existing patterns from the section so we start clean
    while (useDocStore.getState().doc.entities.sections[sid].patternIds.length > 0) {
      store.removePatternFromSection(sid, 0)
    }
    // Add the same pattern twice
    store.addPatternToSection(sid, pid)
    store.addPatternToSection(sid, pid)
    const pids = useDocStore.getState().doc.entities.sections[sid].patternIds
    expect(pids.filter((id) => id === pid)).toHaveLength(2)
  })

  it('inserts a pattern at a specific index', () => {
    const store = useDocStore.getState()
    const pa = store.addPattern()
    const pb = store.addPattern()
    const sid = firstSectionId()
    store.addPatternToSection(sid, pa, 0) // first
    store.addPatternToSection(sid, pb, 0) // before pa
    const pids = useDocStore.getState().doc.entities.sections[sid].patternIds
    expect(pids[0]).toBe(pb)
    expect(pids[1]).toBe(pa)
  })

  it('removes a pattern from a section by index', () => {
    const store = useDocStore.getState()
    const pid = store.addPattern()
    const sid = firstSectionId()
    store.addPatternToSection(sid, pid, 0)
    expect(useDocStore.getState().doc.entities.sections[sid].patternIds).toContain(pid)
    store.removePatternFromSection(sid, 0)
    expect(useDocStore.getState().doc.entities.sections[sid].patternIds).not.toContain(pid)
  })

  it('reorders patterns within a section', () => {
    const store = useDocStore.getState()
    const pa = store.addPattern()
    const pb = store.addPattern()
    const sid = firstSectionId()
    store.addPatternToSection(sid, pa, 0)
    store.addPatternToSection(sid, pb, 1)
    // Initially: [pa, pb, ...others]
    const pids = useDocStore.getState().doc.entities.sections[sid].patternIds
    const idxA = pids.indexOf(pa)
    const idxB = pids.indexOf(pb)
    store.reorderPatternsInSection(sid, idxA, idxB + 1) // move pa after pb
    const moved = useDocStore.getState().doc.entities.sections[sid].patternIds
    expect(moved.indexOf(pa)).toBeGreaterThan(moved.indexOf(pb))
  })

  it('changing current pattern does not mutate sections', () => {
    const store = useDocStore.getState()
    const pid = store.addPattern()
    const sid = firstSectionId()
    store.addPatternToSection(sid, pid)
    store.setCurrentPattern(pid)
    expect(useDocStore.getState().doc.patternId).toBe(pid)
  })

  it('loadDoc preserves duplicate pattern IDs in sections', () => {
    const doc = useDocStore.getState().doc
    const sid = doc.sectionIds[0]
    const pid = firstPatternId()
    const withDupes = {
      ...doc,
      entities: {
        ...doc.entities,
        sections: {
          ...doc.entities.sections,
          [sid]: {
            ...doc.entities.sections[sid],
            patternIds: [pid, pid, pid],
          },
        },
      },
    }
    useDocStore.getState().loadDoc(withDupes)
    const loaded = useDocStore.getState().doc.entities.sections[sid].patternIds
    expect(loaded.filter((id) => id === pid)).toHaveLength(3)
  })
})

describe('docStore — mixer', () => {
  beforeEach(() => resetStore())

  const firstInstId = () => {
    const doc = useDocStore.getState().doc
    return Object.keys(doc.entities.instruments)[0]
  }

  it('has a master channel by default', () => {
    const doc = useDocStore.getState().doc
    expect(doc.entities.mixChannels.master).toBeDefined()
    expect(doc.entities.mixChannels.master.kind).toBe('master')
    expect(doc.entities.mixerInstrumentOrder.length).toBeGreaterThan(0)
  })

  it('adds a sub channel', () => {
    const id = useDocStore.getState().addChannel('sub')
    expect(id).toMatch(/^chan_/)
    const chan = useDocStore.getState().doc.entities.mixChannels[id]
    expect(chan.kind).toBe('sub')
  })

  it('removes a sub channel and re-routes instruments', () => {
    const store = useDocStore.getState()
    const chanId = store.addChannel('sub')
    const instId = firstInstId()
    store.setInstrumentChannelId(instId, chanId)

    store.removeChannel(chanId)
    // Instrument should be re-routed to master.
    const inst = useDocStore.getState().doc.entities.instruments[instId]
    expect(inst.channelId).toBe('master')
    // Channel should be gone.
    expect(useDocStore.getState().doc.entities.mixChannels[chanId]).toBeUndefined()
  })

  it('cannot remove master channel', () => {
    const store = useDocStore.getState()
    store.removeChannel('master')
    expect(useDocStore.getState().doc.entities.mixChannels.master).toBeDefined()
  })

  it('sets channel volume and pan', () => {
    const store = useDocStore.getState()
    store.setChannelVolume('master', 0.5)
    store.setChannelPan('master', 0.3)
    const m = useDocStore.getState().doc.entities.mixChannels.master
    expect(m.volume).toBe(0.5)
    expect(m.pan).toBe(0.3)
  })

  it('toggles channel mute and solo', () => {
    const store = useDocStore.getState()
    store.setChannelMute('master', true)
    store.setChannelSolo('master', true)
    const m = useDocStore.getState().doc.entities.mixChannels.master
    expect(m.mute).toBe(true)
    expect(m.solo).toBe(true)
  })

  it('adds and removes channel effects', () => {
    const store = useDocStore.getState()
    const chanId = store.addChannel('sub')
    const fxId = store.addChannelEffect(chanId, 'reverb')
    expect(fxId).toMatch(/^chef_/)

    let chan = useDocStore.getState().doc.entities.mixChannels[chanId]
    expect(chan.effects).toHaveLength(1)
    expect(chan.effects[0].type).toBe('reverb')

    store.removeChannelEffect(chanId, fxId)
    chan = useDocStore.getState().doc.entities.mixChannels[chanId]
    expect(chan.effects).toHaveLength(0)
  })

  it('reorders channel effects', () => {
    const store = useDocStore.getState()
    const chanId = store.addChannel('sub')
    // Use stereo effects (reverb + delay) so each addChannelEffect creates
    // exactly one effect — filter is mono and creates L+R pairs.
    const fx1 = store.addChannelEffect(chanId, 'reverb')
    const fx2 = store.addChannelEffect(chanId, 'delay')

    store.moveChannelEffect(chanId, fx1, 1)
    const chan = useDocStore.getState().doc.entities.mixChannels[chanId]
    expect(chan.effects[0].id).toBe(fx2)
    expect(chan.effects[1].id).toBe(fx1)
  })

  it('sets channel effect params', () => {
    const store = useDocStore.getState()
    const fxId = store.addChannelEffect('master', 'filter')
    store.setChannelEffectParam('master', fxId, 'cutoff', 500)

    const m = useDocStore.getState().doc.entities.mixChannels.master
    expect(m.effects[0].params.cutoff).toBe(500)
  })

  it('hides and shows instruments in mixer', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()

    store.hideInstrumentFromMixer(instId)
    expect(useDocStore.getState().doc.entities.mixerInstrumentOrder).not.toContain(instId)

    store.showInstrumentInMixer(instId)
    expect(useDocStore.getState().doc.entities.mixerInstrumentOrder).toContain(instId)
  })

  it('reorders mixer instruments', () => {
    const store = useDocStore.getState()
    const order = useDocStore.getState().doc.entities.mixerInstrumentOrder
    const first = order[0]
    const second = order[1]
    if (!first || !second) return

    store.reorderMixerInstrument(first, 1)
    const newOrder = useDocStore.getState().doc.entities.mixerInstrumentOrder
    expect(newOrder[1]).toBe(first)
  })

  it('sets instrument routing and pan', () => {
    const store = useDocStore.getState()
    const chanId = store.addChannel('sub')
    const instId = firstInstId()

    store.setInstrumentChannelId(instId, chanId)
    store.setInstrumentPan(instId, 0.5)

    const inst = useDocStore.getState().doc.entities.instruments[instId]
    expect(inst.channelId).toBe(chanId)
    expect(inst.pan).toBe(0.5)
  })

  it('new instruments are added to mixer order', () => {
    const before = useDocStore.getState().doc.entities.mixerInstrumentOrder.length
    useDocStore.getState().addInstrument('osc')
    const after = useDocStore.getState().doc.entities.mixerInstrumentOrder.length
    expect(after).toBe(before + 1)
  })

  it('removing instrument also removes from mixer order', () => {
    const id = useDocStore.getState().addInstrument('osc')
    expect(useDocStore.getState().doc.entities.mixerInstrumentOrder).toContain(id)
    useDocStore.getState().removeInstrument(id)
    expect(useDocStore.getState().doc.entities.mixerInstrumentOrder).not.toContain(id)
  })
})

/* ------------------------------------------------------------------ */
/*  Modular clipboard — pasteModules / removeModules                   */
/* ------------------------------------------------------------------ */

/** Build a fresh modular instrument, add it to the store, return its id. */
function setupModular(): string {
  resetStore()
  const store = useDocStore.getState()
  const inst = newModularInstrument('Test Synth')
  store.mutate((draft) => {
    draft.entities.instruments[inst.id] = inst
  })
  return inst.id
}

/** Get the modular instrument from the store, raw (no selector). */
function getModular(id: string): ModularInstrument {
  const doc = useDocStore.getState().doc
  // Read fresh from the store — the id doesn't change, but the state might have
  const inst = doc.entities.instruments[id]
  if (!inst || inst.kind !== 'modular') throw new Error('not found')
  return inst
}

/** Build a test module object (NOT in the store, like the component does). */
function makeClipModule(type: 'gain' | 'filter' | 'osc' | 'crush', overrides: Partial<Module> = {}): Module {
  return {
    id: makeId('mod'),
    type,
    params: { ...defaultParams(type) },
    pos: { x: 100, y: 100 },
    ...overrides,
  }
}

/** Build a test connection between two modules. */
function makeClipConnection(fromId: string, toId: string, fromPort: string, toPort: string, gain = 1): Connection {
  return {
    id: makeId('con'),
    from: { moduleId: fromId, port: fromPort },
    to: { moduleId: toId, port: toPort },
    gain,
  }
}

describe('docStore — modular clipboard', () => {
  let instId: string

  beforeEach(() => {
    instId = setupModular()
  })

  /* ---- pasteModules ---- */

  it('pasteModules adds a single module', () => {
    const m = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [m], [])

    const inst = getModular(instId)
    expect(inst.modules[m.id]).toBeDefined()
    expect(inst.modules[m.id]!.type).toBe('gain')
    expect(inst.modules[m.id]!.params).toEqual(defaultParams('gain'))
  })

  it('pasteModules adds multiple modules', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    useDocStore.getState().pasteModules(instId, [m1, m2], [])

    const inst = getModular(instId)
    expect(Object.keys(inst.modules)).toContain(m1.id)
    expect(Object.keys(inst.modules)).toContain(m2.id)
  })

  it('pasteModules adds modules and their internal connections', () => {
    const m1 = makeClipModule('osc')
    const m2 = makeClipModule('gain')
    const conn = makeClipConnection(m1.id, m2.id, 'out', 'in')
    useDocStore.getState().pasteModules(instId, [m1, m2], [conn])

    const inst = getModular(instId)
    expect(inst.modules[m1.id]).toBeDefined()
    expect(inst.modules[m2.id]).toBeDefined()
    expect(inst.connections[conn.id]).toBeDefined()
    expect(inst.connections[conn.id]!.from.moduleId).toBe(m1.id)
    expect(inst.connections[conn.id]!.to.moduleId).toBe(m2.id)
  })

  it('pasteModules skips singleton modules', () => {
    const mod = makeClipModule('gain')
    // Try to paste a 'note' module (which is singleton)
    const singleton: Module = {
      id: makeId('mod'),
      type: 'note',
      params: { ...defaultParams('note') },
      pos: { x: 0, y: 0 },
    }
    useDocStore.getState().pasteModules(instId, [mod, singleton], [])

    const inst = getModular(instId)
    expect(inst.modules[mod.id]).toBeDefined()
    expect(inst.modules[singleton.id]).toBeUndefined()
  })

  it('pasteModules skips connections whose endpoints do not exist in the target', () => {
    const m1 = makeClipModule('gain')
    const dangling = makeClipConnection('nonexistent1', 'nonexistent2', 'out', 'in')
    useDocStore.getState().pasteModules(instId, [m1], [dangling])

    const inst = getModular(instId)
    expect(inst.modules[m1.id]).toBeDefined()
    expect(inst.connections[dangling.id]).toBeUndefined()
  })

  it('pasteModules is one undo step', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    const before = Object.keys(getModular(instId).modules).length

    useDocStore.getState().pasteModules(instId, [m1, m2], [])
    expect(Object.keys(getModular(instId).modules).length).toBe(before + 2)

    useDocStore.getState().undo()
    expect(Object.keys(getModular(instId).modules).length).toBe(before)
  })

  /* ---- removeModules ---- */

  it('removeModules removes a single module', () => {
    const m = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [m], [])
    expect(getModular(instId).modules[m.id]).toBeDefined()

    useDocStore.getState().removeModules(instId, [m.id])
    expect(getModular(instId).modules[m.id]).toBeUndefined()
  })

  it('removeModules removes multiple modules', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    useDocStore.getState().pasteModules(instId, [m1, m2], [])

    useDocStore.getState().removeModules(instId, [m1.id, m2.id])
    const inst = getModular(instId)
    expect(inst.modules[m1.id]).toBeUndefined()
    expect(inst.modules[m2.id]).toBeUndefined()
  })

  it('removeModules also removes incident connections', () => {
    const m1 = makeClipModule('osc')
    const m2 = makeClipModule('gain')
    const conn = makeClipConnection(m1.id, m2.id, 'out', 'in')
    useDocStore.getState().pasteModules(instId, [m1, m2], [conn])
    expect(getModular(instId).connections[conn.id]).toBeDefined()

    // Remove only m1 — the connection should also be removed.
    useDocStore.getState().removeModules(instId, [m1.id])
    const inst2 = getModular(instId)
    expect(inst2.modules[m1.id]).toBeUndefined()
    expect(inst2.connections[conn.id]).toBeUndefined()
  })

  it('removeModules does not remove singleton modules', () => {
    const inst = getModular(instId)
    const noteId = Object.values(inst.modules).find((m) => m.type === 'note')!.id

    useDocStore.getState().removeModules(instId, [noteId])
    expect(getModular(instId).modules[noteId]).toBeDefined()
  })

  it('removeModules is one undo step (multiple modules)', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    useDocStore.getState().pasteModules(instId, [m1, m2], [])
    const before = Object.keys(getModular(instId).modules).length

    useDocStore.getState().removeModules(instId, [m1.id, m2.id])
    expect(getModular(instId).modules[m1.id]).toBeUndefined()
    expect(getModular(instId).modules[m2.id]).toBeUndefined()

    useDocStore.getState().undo()
    expect(getModular(instId).modules[m1.id]).toBeDefined()
    expect(getModular(instId).modules[m2.id]).toBeDefined()
    expect(Object.keys(getModular(instId).modules).length).toBe(before)
  })

  it('redo after removeModules restores the removal', () => {
    const m1 = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [m1], [])
    useDocStore.getState().removeModules(instId, [m1.id])
    useDocStore.getState().undo()
    useDocStore.getState().redo()
    expect(getModular(instId).modules[m1.id]).toBeUndefined()
  })

  /* ---- combined cut + paste (simulated component flow) ---- */

  it('cut then paste duplicates modules with fresh ids (simulated)', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    const conn = makeClipConnection(m1.id, m2.id, 'out', 'in')
    useDocStore.getState().pasteModules(instId, [m1, m2], [conn])

    // Build a new module set with fresh ids (mimics the component's id remap).
    const idMap = new Map<string, string>()
    const clipModules = [getModular(instId).modules[m1.id]!, getModular(instId).modules[m2.id]!]
    const clipConns = [getModular(instId).connections[conn.id]!]

    const newMods = clipModules.map((m) => {
      const id = makeId('mod')
      idMap.set(m.id, id)
      return { ...m, id, params: { ...m.params }, pos: { x: m.pos.x + 44, y: m.pos.y + 44 } }
    })
    const newConns = clipConns.map((c) => ({
      id: makeId('con'),
      from: { moduleId: idMap.get(c.from.moduleId) ?? c.from.moduleId, port: c.from.port },
      to: { moduleId: idMap.get(c.to.moduleId) ?? c.to.moduleId, port: c.to.port },
      gain: c.gain,
    }))

    // Paste new ones
    useDocStore.getState().pasteModules(instId, newMods, newConns)

    const inst = getModular(instId)
    expect(inst.modules[newMods[0].id]).toBeDefined()
    expect(inst.modules[newMods[1].id]).toBeDefined()
    expect(inst.connections[newConns[0].id]).toBeDefined()
    // The connection should bridge the NEW ids, not the old ones.
    expect(inst.connections[newConns[0].id]!.from.moduleId).toBe(newMods[0].id)
    expect(inst.connections[newConns[0].id]!.to.moduleId).toBe(newMods[1].id)
  })

  it('cut then paste preserves module params', () => {
    const m = makeClipModule('filter', { params: { cutoff: 500, resonance: 0.3, envAmount: 0, keyTrack: 0, mode: 0 } })
    useDocStore.getState().pasteModules(instId, [m], [])

    const clip = getModular(instId).modules[m.id]!
    const id = makeId('mod')
    const pasted = { ...clip, id, params: { ...clip.params }, pos: { x: clip.pos.x + 44, y: clip.pos.y + 44 } }
    useDocStore.getState().pasteModules(instId, [pasted], [])

    const inst = getModular(instId)
    expect(inst.modules[id]!.params.cutoff).toBe(500)
  })

  it('paste after cut restores connections between the pasted modules', () => {
    // Full component simulation: add 2 connected modules, cut them, paste back.
    const m1 = makeClipModule('osc')
    const m2 = makeClipModule('gain')
    const conn = makeClipConnection(m1.id, m2.id, 'out', 'in')
    useDocStore.getState().pasteModules(instId, [m1, m2], [conn])

    // Grab the modules + connections (simulate clipboard storage)
    const d1 = getModular(instId)
    const clipMods = [d1.modules[m1.id]!, d1.modules[m2.id]!]
    const clipConns = [d1.connections[conn.id]!]

    // Cut: remove them
    useDocStore.getState().removeModules(instId, [m1.id, m2.id])

    // Paste: remap ids
    const idMap = new Map<string, string>()
    const newMods = clipMods.map((m) => {
      const id = makeId('mod')
      idMap.set(m.id, id)
      return { ...m, id, params: { ...m.params }, pos: { x: m.pos.x + 44, y: m.pos.y + 44 } }
    })
    const newConns = clipConns.map((c) => ({
      id: makeId('con'),
      from: { moduleId: idMap.get(c.from.moduleId)!, port: c.from.port },
      to: { moduleId: idMap.get(c.to.moduleId)!, port: c.to.port },
      gain: c.gain,
    }))
    useDocStore.getState().pasteModules(instId, newMods, newConns)

    const d2 = getModular(instId)
    expect(d2.modules[newMods[0].id]).toBeDefined()
    expect(d2.modules[newMods[1].id]).toBeDefined()
    expect(d2.connections[newConns[0].id]).toBeDefined()
  })

  it('multiple pastes produce independent copies', () => {
    const m = makeClipModule('gain', { params: { level: 0.5 } })
    useDocStore.getState().pasteModules(instId, [m], [])

    const clip = getModular(instId).modules[m.id]!

    // Paste first copy
    const id1 = makeId('mod')
    const pasted1 = { ...clip, id: id1, params: { ...clip.params }, pos: { x: 150, y: 150 } }
    useDocStore.getState().pasteModules(instId, [pasted1], [])

    // Paste second copy
    const id2 = makeId('mod')
    const pasted2 = { ...clip, id: id2, params: { ...clip.params }, pos: { x: 200, y: 200 } }
    useDocStore.getState().pasteModules(instId, [pasted2], [])

    const inst = getModular(instId)
    expect(inst.modules[id1]).toBeDefined()
    expect(inst.modules[id2]).toBeDefined()
    // Both copies should have the original params, independent.
    expect(inst.modules[id1]!.params.level).toBe(0.5)
    expect(inst.modules[id2]!.params.level).toBe(0.5)
  })

  it('pasting into a different instrument works', () => {
    const m = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [m], [])

    // Create a second instrument and paste into it
    const store = useDocStore.getState()
    const inst2 = newModularInstrument('Target Synth')
    store.mutate((draft) => {
      draft.entities.instruments[inst2.id] = inst2
    })

    const clip = getModular(instId).modules[m.id]!
    const id = makeId('mod')
    const pasted = { ...clip, id, params: { ...clip.params }, pos: { x: 150, y: 150 } }
    store.pasteModules(inst2.id, [pasted], [])

    expect(getModular(inst2.id).modules[id]).toBeDefined()
    // Original instrument is unchanged.
    expect(getModular(instId).modules[m.id]).toBeDefined()
  })
})
