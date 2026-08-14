import { describe, expect, it, beforeEach } from 'vitest'
import { useDocStore } from '../state/docStore'
import { createDefaultDoc, makeId, newModularInstrument } from '../domain/factory'
import type { Connection, Doc, Module, ModularInstrument } from '../domain/types'
import { defaultParams, MODULE_DEFS } from '../domain/moduleDefs'
import { collectClipboardModules, preparePastedModules } from '../domain/clipboard'

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
    const newTid = pat.trackIds.at(-1)!
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

  it('creates a new pattern from the selected one with all lanes cleared', () => {
    const store = useDocStore.getState()
    const srcId = firstPatternId()
    const src = useDocStore.getState().doc.entities.patterns[srcId]
    // Give the source some data so the clearing is observable.
    store.addEffectLane(src.trackIds[0], 'panning')
    const laneId = useDocStore.getState().doc.entities.tracks[src.trackIds[0]].effectLanes[0].id
    store.setCellEffectLane(src.trackIds[0], 0, laneId, 0.5)

    const id = store.addPattern()
    expect(id).toMatch(/^pat_/)
    const doc = useDocStore.getState().doc
    const pat = doc.entities.patterns[id]
    expect(pat.name).toMatch(/^Pattern \d+$/)
    // The new pattern is selected immediately.
    expect(doc.patternId).toBe(id)
    // Same structure and length as the selected pattern…
    expect(pat.length).toBe(src.length)
    expect(pat.trackIds).toHaveLength(src.trackIds.length)
    for (let i = 0; i < src.trackIds.length; i++) {
      const srcTrack = doc.entities.tracks[src.trackIds[i]]
      const newTrack = doc.entities.tracks[pat.trackIds[i]]
      expect(newTrack.instrumentId).toBe(srcTrack.instrumentId)
      // Lane definitions follow the track, but every cell is cleared.
      expect(newTrack.effectLanes).toEqual(srcTrack.effectLanes)
      for (const cell of newTrack.cells) {
        expect(cell.note).toBeNull()
        expect(cell.volume).toBeNull()
        expect(cell.effectLanes).toEqual({})
      }
    }
    // New patterns are not added to any section — the user arranges manually.
    for (const section of Object.values(doc.entities.sections)) {
      expect(section.patternIds).not.toContain(id)
    }
  })

  it('creates a bare 32-row pattern when there is no pattern to base it on', () => {
    const doc = createDefaultDoc()
    doc.entities.patterns = {}
    doc.patternId = 'none'
    useDocStore.getState().loadDoc(doc)

    const id = useDocStore.getState().addPattern()
    const loaded = useDocStore.getState().doc
    const pat = loaded.entities.patterns[id]
    expect(pat.length).toBe(32)
    expect(pat.trackIds).toEqual([])
    expect(loaded.patternId).toBe(id)
  })

  it('duplicates a pattern', () => {
    const store = useDocStore.getState()
    const pid = firstPatternId()
    const dupId = store.duplicatePattern(pid)
    expect(dupId).not.toBe('')
    expect(dupId).not.toBe(pid)
    const dup = useDocStore.getState().doc.entities.patterns[dupId]
    expect(dup.name).toContain('(copy)')
    // Duplicates are not added to any section — the user arranges manually.
    for (const section of Object.values(useDocStore.getState().doc.entities.sections)) {
      expect(section.patternIds).not.toContain(dupId)
    }
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
    useDocStore.getState().addInstrument('modular')
    const after = useDocStore.getState().doc.entities.mixerInstrumentOrder.length
    expect(after).toBe(before + 1)
  })

  it('removing instrument also removes from mixer order', () => {
    const id = useDocStore.getState().addInstrument('modular')
    expect(useDocStore.getState().doc.entities.mixerInstrumentOrder).toContain(id)
    useDocStore.getState().removeInstrument(id)
    expect(useDocStore.getState().doc.entities.mixerInstrumentOrder).not.toContain(id)
  })
})

/* ------------------------------------------------------------------ */
/*  Modular clipboard — pasteModules / removeModules / moveModules      */
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
function makeClipModule(type: 'gain' | 'filter' | 'osc' | 'crush' | 'eff', overrides: Partial<Module> = {}): Module {
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

/*  paste-then-select — auto-select pasted nodes                          */
describe('paste-then-select round-trip', () => {
  let instId: string

  beforeEach(() => {
    instId = setupModular()
  })

  it('preparePastedModules returns ids that match store after pasteModules', () => {
    const inst = getModular(instId)
    const nonSingletons = Object.keys(inst.modules).filter(
      (id) => !MODULE_DEFS[inst.modules[id].type].singleton,
    )
    const clip = collectClipboardModules(inst, nonSingletons)!
    const { modules: prepared } = preparePastedModules(clip)
    const pastedIds = prepared.map((m) => m.id)

    // Paste into the store.
    useDocStore.getState().pasteModules(instId, prepared, [])

    // All prepared IDs must exist in the store now.
    const storeInst = getModular(instId)
    for (const id of pastedIds) {
      expect(storeInst.modules[id]).toBeDefined()
    }
  })

  it('pasted ids are unique — no collision with existing or other pasted ids', () => {
    const inst = getModular(instId)
    const existingIds = new Set(Object.keys(inst.modules))
    const nonSingletons = Object.keys(inst.modules).filter(
      (id) => !MODULE_DEFS[inst.modules[id].type].singleton,
    )
    const clip = collectClipboardModules(inst, nonSingletons)!

    // Paste twice — both sets should have unique, non-colliding ids.
    const a = preparePastedModules(clip)
    const b = preparePastedModules(clip)

    useDocStore.getState().pasteModules(instId, a.modules, a.connections)
    useDocStore.getState().pasteModules(instId, b.modules, b.connections)

    const idsA = new Set(a.modules.map((m) => m.id))
    const idsB = new Set(b.modules.map((m) => m.id))

    // No overlap with existing ids.
    for (const id of idsA) expect(existingIds.has(id)).toBe(false)
    for (const id of idsB) expect(existingIds.has(id)).toBe(false)
    // No overlap between the two pastes.
    for (const id of idsA) expect(idsB.has(id)).toBe(false)
  })

  it('pasted connections reference only pasted module ids', () => {
    const inst = getModular(instId)
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const filterId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'filter')!
    const clip = collectClipboardModules(inst, [oscId, filterId])!
    const { modules, connections } = preparePastedModules(clip)

    useDocStore.getState().pasteModules(instId, modules, connections)

    const pastedIds = new Set(modules.map((m) => m.id))
    const storeInst = getModular(instId)
    for (const c of connections) {
      const stored = storeInst.connections[c.id]
      expect(stored).toBeDefined()
      // Both endpoints must be in the pasted set.
      expect(pastedIds.has(stored.from.moduleId)).toBe(true)
      expect(pastedIds.has(stored.to.moduleId)).toBe(true)
    }
  })

  it('prepare → paste → find yields correct count and types', () => {
    const inst = getModular(instId)
    const nonSingletons = Object.keys(inst.modules).filter(
      (id) => !MODULE_DEFS[inst.modules[id].type].singleton,
    )
    const clip = collectClipboardModules(inst, nonSingletons)!
    const { modules, connections } = preparePastedModules(clip)
    const before = Object.keys(getModular(instId).modules).length

    useDocStore.getState().pasteModules(instId, modules, connections)

    const storeInst = getModular(instId)
    const allIds = Object.keys(storeInst.modules)
    expect(allIds.length).toBe(before + modules.length)

    // Pasted modules are present with correct type.
    for (const m of modules) {
      expect(storeInst.modules[m.id].type).toBe(m.type)
    }
  })
})

/*  moveModules — batch position updates for multi-node drag              */
describe('docStore — moveModules', () => {
  let instId: string

  beforeEach(() => {
    instId = setupModular()
  })

  it('moveModules moves a single module', () => {
    const mod = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [mod], [])
    const newPos = { x: 200, y: 300 }

    useDocStore.getState().moveModules(instId, [{ id: mod.id, pos: newPos }])

    const got = getModular(instId).modules[mod.id]
    expect(got).toBeDefined()
    expect(got.pos).toEqual(newPos)
  })

  it('moveModules moves multiple modules in one call', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    useDocStore.getState().pasteModules(instId, [m1, m2], [])

    const pos1 = { x: 111, y: 222 }
    const pos2 = { x: 333, y: 444 }
    useDocStore.getState().moveModules(instId, [
      { id: m1.id, pos: pos1 },
      { id: m2.id, pos: pos2 },
    ])

    expect(getModular(instId).modules[m1.id].pos).toEqual(pos1)
    expect(getModular(instId).modules[m2.id].pos).toEqual(pos2)
  })

  it('moveModules is one undo step', () => {
    const m1 = makeClipModule('gain')
    const m2 = makeClipModule('filter')
    useDocStore.getState().pasteModules(instId, [m1, m2], [])
    const origPos1 = { ...getModular(instId).modules[m1.id].pos }
    const origPos2 = { ...getModular(instId).modules[m2.id].pos }

    useDocStore.getState().moveModules(instId, [
      { id: m1.id, pos: { x: 999, y: 111 } },
      { id: m2.id, pos: { x: 888, y: 222 } },
    ])

    expect(getModular(instId).modules[m1.id].pos).toEqual({ x: 999, y: 111 })
    expect(getModular(instId).modules[m2.id].pos).toEqual({ x: 888, y: 222 })

    useDocStore.getState().undo()

    // Both modules should revert to their original positions with ONE undo.
    expect(getModular(instId).modules[m1.id].pos).toEqual(origPos1)
    expect(getModular(instId).modules[m2.id].pos).toEqual(origPos2)
  })

  it('redo after moveModules restores the batch move', () => {
    const m1 = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [m1], [])
    const newPos = { x: 500, y: 600 }

    useDocStore.getState().moveModules(instId, [{ id: m1.id, pos: newPos }])
    useDocStore.getState().undo()
    expect(getModular(instId).modules[m1.id].pos).not.toEqual(newPos)

    useDocStore.getState().redo()
    expect(getModular(instId).modules[m1.id].pos).toEqual(newPos)
  })

  it('ignores unknown module ids', () => {
    const mod = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [mod], [])
    const newPos = { x: 100, y: 200 }

    useDocStore.getState().moveModules(instId, [
      { id: mod.id, pos: newPos },
      { id: 'nonexistent', pos: { x: 0, y: 0 } },
    ])

    expect(getModular(instId).modules[mod.id].pos).toEqual(newPos)
  })

  it('no-op for unknown instrument (no history entry)', () => {
    const pastLen = useDocStore.getState().past.length
    useDocStore.getState().moveModules('nonexistent', [
      { id: 'any', pos: { x: 1, y: 2 } },
    ])
    expect(useDocStore.getState().past.length).toBe(pastLen)
  })

  it('same-position move still creates history entry (Immer sees new object ref)', () => {
    const mod = makeClipModule('gain')
    useDocStore.getState().pasteModules(instId, [mod], [])
    const cur = getModular(instId).modules[mod.id].pos
    const pastLen = useDocStore.getState().past.length

    // Reassign the same coordinates as a new object — Immer sees the assignment as a change.
    useDocStore.getState().moveModules(instId, [{ id: mod.id, pos: { ...cur } }])

    expect(useDocStore.getState().past.length).toBe(pastLen + 1)
    expect(getModular(instId).modules[mod.id].pos).toEqual(cur)
  })
})

describe('docStore — eff inlet naming', () => {
  let instId: string

  beforeEach(() => {
    instId = setupModular()
  })

  const effModules = (id: string) =>
    Object.values(getModular(id).modules).filter((m) => m.type === 'eff')

  /** Add a track bound to `instId` to the current pattern, return its id. */
  const addTrackUsing = (instrumentId: string): string => {
    const store = useDocStore.getState()
    const pat = store.doc.entities.patterns[store.doc.patternId]
    store.addTrack(pat.trackIds.length, instrumentId)
    const doc = useDocStore.getState().doc // fresh state — the old `store` ref is stale
    return doc.entities.patterns[doc.patternId].trackIds[pat.trackIds.length]
  }

  it('addModule auto-names eff modules uniquely', () => {
    const store = useDocStore.getState()
    store.addModule(instId, 'eff', { x: 0, y: 0 })
    store.addModule(instId, 'eff', { x: 0, y: 0 })
    // Seeded with Eff In 01/02, so new ones continue at 03/04.
    expect(effModules(instId).map((m) => m.name)).toEqual(['Eff In 01', 'Eff In 02', 'Eff In 03', 'Eff In 04'])
  })

  it('addModule reuses the lowest free eff name after deletion', () => {
    const store = useDocStore.getState()
    const eff1 = effModules(instId).find((m) => m.name === 'Eff In 01')!
    store.removeModule(instId, eff1.id)
    store.addModule(instId, 'eff', { x: 0, y: 0 })
    expect(effModules(instId).map((m) => m.name)).toEqual(['Eff In 02', 'Eff In 01'])
  })

  it('addModule does not name non-eff modules', () => {
    useDocStore.getState().addModule(instId, 'gain', { x: 0, y: 0 })
    const gain = Object.values(getModular(instId).modules).find((m) => m.type === 'gain')
    expect(gain?.name).toBeUndefined()
  })

  it('renameModule renames the inlet and remaps lanes on tracks using the instrument', () => {
    const store = useDocStore.getState()
    const trackId = addTrackUsing(instId)
    store.addEffectLane(trackId, 'Eff In 01')
    const laneId = useDocStore.getState().doc.entities.tracks[trackId].effectLanes[0].id
    store.setCellEffectLane(trackId, 0, laneId, 0.75)

    const eff1 = effModules(instId).find((m) => m.name === 'Eff In 01')!
    store.renameModule(instId, eff1.id, 'Filter Cutoff')

    expect(getModular(instId).modules[eff1.id].name).toBe('Filter Cutoff')
    const track = useDocStore.getState().doc.entities.tracks[trackId]
    expect(track.effectLanes[0].type).toBe('Filter Cutoff')
    // Cell values keep their lane id — only the type string follows the name.
    expect(track.cells[0].effectLanes[laneId]).toBe(0.75)
  })

  it('renameModule leaves lanes on tracks using other instruments alone', () => {
    const store = useDocStore.getState()
    const modTrack = addTrackUsing(instId)
    const kitInst = Object.values(useDocStore.getState().doc.entities.instruments).find((i) => i.kind === 'drumkit')!
    const kitTrack = addTrackUsing(kitInst.id)
    for (const tid of [modTrack, kitTrack]) store.addEffectLane(tid, 'Eff In 01')

    const eff1 = effModules(instId).find((m) => m.name === 'Eff In 01')!
    store.renameModule(instId, eff1.id, 'Filter Cutoff')

    const doc = useDocStore.getState().doc
    expect(doc.entities.tracks[modTrack].effectLanes[0].type).toBe('Filter Cutoff')
    expect(doc.entities.tracks[kitTrack].effectLanes[0].type).toBe('Eff In 01')
  })

  it('renameModule rejects empty and duplicate names', () => {
    const store = useDocStore.getState()
    const [eff1, eff2] = effModules(instId)

    store.renameModule(instId, eff1.id, '   ')
    expect(getModular(instId).modules[eff1.id].name).toBe('Eff In 01')

    store.renameModule(instId, eff1.id, eff2.name!)
    expect(getModular(instId).modules[eff1.id].name).toBe('Eff In 01')
  })

  it('renameModule renames a previously unnamed eff module', () => {
    const store = useDocStore.getState()
    // Insert an unnamed eff module the way old saves had them.
    store.mutate((draft) => {
      const inst = draft.entities.instruments[instId]
      if (inst?.kind === 'modular') {
        inst.modules.plain = { id: 'plain', type: 'eff', params: { cc: 0 }, pos: { x: 0, y: 0 } }
      }
    })

    store.renameModule(instId, 'plain', 'My Inlet')
    expect(getModular(instId).modules.plain.name).toBe('My Inlet')
  })

  it('pasteModules gives pasted eff modules fresh unique names', () => {
    const m1 = makeClipModule('eff', { name: 'Eff In 01' })
    const m2 = makeClipModule('eff', { name: 'Eff In 02' })
    useDocStore.getState().pasteModules(instId, [m1, m2], [])

    const inst = getModular(instId)
    expect(inst.modules[m1.id].name).toBe('Eff In 03')
    expect(inst.modules[m2.id].name).toBe('Eff In 04')
    // All eff names in the instrument remain unique.
    const names = effModules(instId).map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('renameModule is undoable', () => {
    const store = useDocStore.getState()
    const eff1 = effModules(instId).find((m) => m.name === 'Eff In 01')!
    store.renameModule(instId, eff1.id, 'Filter Cutoff')
    expect(getModular(instId).modules[eff1.id].name).toBe('Filter Cutoff')

    store.undo()
    expect(getModular(instId).modules[eff1.id].name).toBe('Eff In 01')

    store.redo()
    expect(getModular(instId).modules[eff1.id].name).toBe('Filter Cutoff')
  })
})

describe('docStore — sample assets', () => {
  beforeEach(() => resetStore())

  const addSample = () => {
    const id = makeId('smp')
    useDocStore.getState().addSampleEntity({
      id,
      name: 'Kick',
      hash: 'hash-old',
      originalName: 'kick.wav',
      sampleRate: 44100,
      channels: 1,
      frames: 44100,
    })
    return id
  }

  it('replaceSampleAsset updates metadata including the new original filename', () => {
    const id = addSample()
    useDocStore.getState().replaceSampleAsset(id, 'hash-new', 'snare.wav', 48000, 2, 96000)

    const sample = useDocStore.getState().doc.entities.samples[id]
    expect(sample.hash).toBe('hash-new')
    expect(sample.originalName).toBe('snare.wav')
    expect(sample.sampleRate).toBe(48000)
    expect(sample.channels).toBe(2)
    expect(sample.frames).toBe(96000)
  })

  it('replaceSampleAsset is undoable', () => {
    const id = addSample()
    useDocStore.getState().replaceSampleAsset(id, 'hash-new', 'snare.wav', 48000, 2, 96000)

    useDocStore.getState().undo()
    const sample = useDocStore.getState().doc.entities.samples[id]
    expect(sample.hash).toBe('hash-old')
    expect(sample.originalName).toBe('kick.wav')
  })
})
