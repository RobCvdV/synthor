import { create } from 'zustand'
import { applyPatches, enablePatches, type Patch, produceWithPatches } from 'immer'
import type { Cell, Connection, Doc, DrumKitSlot, EffectLaneDef, Id, Instrument, Module, ModuleType, Pattern, Port, SampleEntity } from '../domain/types'
import { getSlotForNote, MASTER_CHANNEL_ID } from '../domain/types'
import { clearParamRefs, updateParamRef } from '../audio/paramRefs'
import {
  cloneInstrument,
  createChannelEffect,
  createDefaultDoc,
  createMixChannel,
  fitCells,
  makeId,
  newDrumKitInstrument,
  newModularInstrument,
  newOscInstrument,
  newSection,
  newTrack,
} from '../domain/factory'
import { defaultParams, isStereoEffect, MODULE_DEFS } from '../domain/moduleDefs'

enablePatches()

/** One undoable step: forward patches and their inverse. */
interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
}

/** A detached copy of a track + its instrument, for copy/paste. Stores the full
 *  instrument (osc or modular); paste clones it with fresh ids. */
interface TrackSnapshot {
  instrument: Instrument
  cells: Cell[]
}

interface DocState {
  doc: Doc
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Non-undoable scratch space for track copy/paste. */
  trackClipboard: TrackSnapshot | null
  /** Non-undoable scratch space for rectangular cell copy/paste. */
  rectClipboard: Cell[][] | null
  /** Non-undoable performance state: which tracks are muted (keyed by id). */
  mutedTracks: Record<Id, boolean>
  /** Non-undoable performance state: which tracks are soloed (keyed by id). */
  soloedTracks: Record<Id, boolean>
  /** Counter bumped to force a render (e.g. after host.start() mounts refs). */
  compileTick: number
  /** Bump to trigger a render via store subscription. */
  bumpCompile: () => void
  /** When true, docStore subscribers skip their side effects — used by
   *  mutateSilent to persist values without triggering graph recompiles. */
  silentBatch: boolean
  /** Like mutate, but sets silentBatch so subscribers can skip the compile.
   *  Use for slider release — persist to store + undo without recompile. */
  mutateSilent: (recipe: (draft: Doc) => void) => void

  /** Hashes of samples that loaded successfully into VFS. null = not yet synced. */
  vfsLoadedHashes: Set<string> | null

  /** Store which sample hashes loaded into VFS after a sync. */
  setVfsLoaded: (hashes: Set<string>) => void

  /** Run an Immer recipe against the doc, recording it as one undoable edit. */
  mutate: (recipe: (draft: Doc) => void) => void
  undo: () => void
  redo: () => void
  /** Replace the whole document (e.g. loading a saved song). Resets history. */
  loadDoc: (doc: Doc) => void

  // --- Cell editing ---
  setCellNote: (trackId: Id, row: number, note: number | null) => void
  setCellNoteOff: (trackId: Id, row: number, noteOff: boolean) => void
  setCellVolume: (trackId: Id, row: number, volume: number | null) => void
  addEffectLane: (trackId: Id, type: string) => void
  removeEffectLane: (trackId: Id, laneId: Id) => void
  setEffectLaneType: (trackId: Id, laneId: Id, newType: string) => void
  setCellEffectLane: (trackId: Id, row: number, laneId: Id, value: number | null) => void

  // --- Pattern operations ---
  setPatternLength: (patternId: Id, length: number) => void
  renamePattern: (patternId: Id, name: string) => void
  addPattern: (name?: string, length?: number) => Id
  removePattern: (patternId: Id) => void
  duplicatePattern: (patternId: Id) => Id
  setCurrentPattern: (patternId: Id) => void

  // --- Section operations ---
  addSection: (name?: string) => Id
  removeSection: (sectionId: Id) => void
  renameSection: (sectionId: Id, name: string) => void
  addPatternToSection: (sectionId: Id, patternId: Id, atIndex?: number) => void
  removePatternFromSection: (sectionId: Id, patternIndex: number) => void
  reorderSections: (fromIdx: number, toIdx: number) => void
  reorderPatternsInSection: (sectionId: Id, fromIdx: number, toIdx: number) => void

  // --- Instrument operations (first-class, shared across tracks) ---
  addInstrument: (kind: Instrument['kind']) => Id
  removeInstrument: (instrumentId: Id) => void
  renameInstrument: (instrumentId: Id, name: string) => void
  /** Set an effect range max value on an instrument. */
  setEffectSetting: (instrumentId: Id, key: string, value: number) => void
  /** Set a top-level param on an osc instrument (e.g. gain). */
  setOscParam: (instrumentId: Id, key: string, value: number) => void
  setOscParamFast: (instrumentId: Id, key: string, value: number) => void
  setOscParamSilent: (instrumentId: Id, key: string, value: number) => void
  setTrackInstrument: (trackId: Id, instrumentId: Id) => void

  // --- Modular graph editing (on a modular instrument) ---
  addModule: (instrumentId: Id, type: ModuleType, pos: { x: number; y: number }) => void
  removeModule: (instrumentId: Id, moduleId: Id) => void
  moveModule: (instrumentId: Id, moduleId: Id, pos: { x: number; y: number }) => void
  setModuleParam: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  /** Update param ref immediately without triggering a recompile.
   *  Use during slider drags for smooth audio; call setModuleParamSilent
   *  on drag-end to persist the value in the store without triggering compile. */
  setModuleParamFast: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  /** Persist a module param to the store + undo history WITHOUT triggering
   *  a graph recompile. Use on slider mouseUp after the fast path already
   *  updated the ref. */
  setModuleParamSilent: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  addConnection: (instrumentId: Id, from: Port, to: Port) => void
  removeConnection: (instrumentId: Id, connectionId: Id) => void
  setConnectionGain: (instrumentId: Id, connectionId: Id, gain: number) => void
  /** Ensure a modular instrument has its singleton source modules (effect1/2 etc.).
   *  Idempotent — only adds modules that are missing. Called on editor mount so
   *  existing patches get new source modules automatically. */
  ensureModularSingletons: (instrumentId: Id) => void
  /** Duplicate an existing instrument (deep-clone with fresh ids). */
  duplicateInstrument: (instrumentId: Id) => Id
  /** Remove a batch of modules (and their incident connections) in one undo step. */
  removeModules: (instrumentId: Id, moduleIds: Id[]) => void
  /** Paste a group of modules + connections in one undo step. */
  pasteModules: (instrumentId: Id, modules: Module[], connections: Connection[]) => void

  // --- Sample management ---
  addSampleEntity: (entity: SampleEntity) => void
  removeSampleEntity: (id: Id) => void
  replaceSampleAsset: (id: Id, hash: string, sampleRate: number, channels: number, frames: number) => void
  renameSample: (id: Id, name: string) => void

  // --- Drum kit operations ---
  addDrumKitSlot: (instrumentId: Id, note: number, sampleId?: Id, slotInstrumentId?: Id) => void
  removeDrumKitSlot: (instrumentId: Id, slotId: Id) => void
  setDrumKitSlotParam: (instrumentId: Id, slotId: Id, key: 'note' | 'pitchOffset' | 'gain' | 'pan', value: number) => void
  /** Set a param on the slot at the given note. If the slot is inherited,
   *  promotes it (copies parent source) and sets the param in one undo step. */
  setOrPromoteSlotParam: (instrumentId: Id, note: number, key: 'pitchOffset' | 'gain' | 'pan', value: number) => void
  setDrumKitSlotSource: (instrumentId: Id, slotId: Id, sampleId: Id | null, slotInstrumentId: Id | null) => void
  setDrumKitParam: (instrumentId: Id, key: string, value: number) => void
  setDrumKitParamFast: (instrumentId: Id, key: string, value: number) => void
  setDrumKitKeyRange: (instrumentId: Id, keyLo: number, keyHi: number) => void

  // --- Track operations (atIndex = position within the current pattern) ---
  addTrack: (atIndex: number, instrumentId: Id) => void
  removeTrack: (trackId: Id) => void
  moveTrack: (from: number, to: number) => void
  copyTrack: (trackId: Id) => void
  pasteTrack: (atIndex: number) => void
  duplicateTrack: (trackId: Id, atIndex: number) => void
  /** Rotate a track's cells one row up or down, wrapping around. */
  shiftTrack: (trackId: Id, dir: 'up' | 'down') => void
  /** Toggle a track's mute (performance state, not part of undo history). */
  toggleMute: (trackId: Id) => void
  /** Toggle a track's solo (performance state, not part of undo history). */
  toggleSolo: (trackId: Id) => void

  // --- Rectangular cell clipboard (non-undoable) ---
  copyRect: (trackIds: Id[], startRow: number, endRow: number, startTrack: number, endTrack: number) => void
  cutRect: (trackIds: Id[], startRow: number, endRow: number, startTrack: number, endTrack: number) => void
  pasteRect: (trackIds: Id[], atRow: number, atTrack: number) => void

  // --- Mixer actions ---
  addChannel: (kind: 'sub') => Id
  removeChannel: (channelId: Id) => void
  renameChannel: (channelId: Id, name: string) => void
  setChannelVolume: (channelId: Id, vol: number) => void
  setChannelVolumeFast: (channelId: Id, vol: number) => void
  setChannelPan: (channelId: Id, pan: number) => void
  setChannelMute: (channelId: Id, mute: boolean) => void
  setChannelSolo: (channelId: Id, solo: boolean) => void
  addChannelEffect: (channelId: Id, type: ModuleType) => Id
  removeChannelEffect: (channelId: Id, effectId: Id) => void
  moveChannelEffect: (channelId: Id, effectId: Id, newIndex: number) => void
  setChannelEffectParam: (channelId: Id, effectId: Id, key: string, value: number) => void
  setChannelEffectParamFast: (channelId: Id, effectId: Id, key: string, value: number) => void
  hideInstrumentFromMixer: (instrumentId: Id) => void
  showInstrumentInMixer: (instrumentId: Id) => void
  reorderMixerInstrument: (instrumentId: Id, newIndex: number) => void
  setInstrumentChannelId: (instrumentId: Id, channelId: Id) => void
  setInstrumentPan: (instrumentId: Id, pan: number) => void
  setInstrumentPanFast: (instrumentId: Id, pan: number) => void
  setInstrumentPanSilent: (instrumentId: Id, pan: number) => void
  setDrumKitParamSilent: (instrumentId: Id, key: string, value: number) => void
  setChannelVolumeSilent: (channelId: Id, vol: number) => void
  setChannelPanSilent: (channelId: Id, pan: number) => void
  setChannelEffectParamSilent: (channelId: Id, effectId: Id, key: string, value: number) => void
}

const HISTORY_LIMIT = 200

export const useDocStore = create<DocState>((set, get) => ({
  doc: createDefaultDoc(),
  past: [],
  future: [],
  trackClipboard: null,
  rectClipboard: null,
  mutedTracks: {},
  soloedTracks: {},
  vfsLoadedHashes: null,
  compileTick: 0,
  silentBatch: false,

  bumpCompile: () => set((s) => ({ compileTick: s.compileTick + 1 })),

  mutateSilent: (recipe) => {
    set({ silentBatch: true })
    get().mutate(recipe)
    set({ silentBatch: false })
  },

  mutate: (recipe) => {
    const { doc, past } = get()
    const [next, patches, inverse] = produceWithPatches(doc, recipe)
    if (patches.length === 0) return // no-op edit, don't pollute history
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(1) : past
    set({ doc: next, past: [...trimmed, { patches, inverse }], future: [] })
  },

  loadDoc: (doc) =>
    set({ doc, past: [], future: [], trackClipboard: null, rectClipboard: null, mutedTracks: {}, soloedTracks: {}, vfsLoadedHashes: null }),

  undo: () => {
    const { doc, past, future } = get()
    const entry = past[past.length - 1]
    if (!entry) return
    set({ doc: applyPatches(doc, entry.inverse), past: past.slice(0, -1), future: [entry, ...future] })
    clearParamRefs() // refs hold stale values after undo
  },

  redo: () => {
    const { doc, past, future } = get()
    const entry = future[0]
    if (!entry) return
    set({ doc: applyPatches(doc, entry.patches), past: [...past, entry], future: future.slice(1) })
    clearParamRefs() // refs hold stale values after redo
  },

  setCellNote: (trackId, row, note) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && track.cells[row]) {
        track.cells[row].note = note
        // Setting a note clears note-off (they're mutually exclusive).
        if (note !== null) track.cells[row].noteOff = false
      }
    }),

  setCellNoteOff: (trackId, row, noteOff) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && track.cells[row]) {
        track.cells[row].noteOff = noteOff
        // Note-off and note are mutually exclusive: note-off clears any note.
        if (noteOff) track.cells[row].note = null
      }
    }),

  setCellVolume: (trackId, row, volume) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && track.cells[row]) track.cells[row].volume = volume
    }),

  setCellEffectLane: (trackId, row, laneId, value) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && track.cells[row]) track.cells[row].effectLanes[laneId] = value
    }),

  addEffectLane: (trackId, type) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (!track) return
      const id = makeId('lan')
      const lane: EffectLaneDef = { id, type }
      track.effectLanes.push(lane)
      for (const cell of track.cells) {
        cell.effectLanes[id] = null
      }
    }),

  removeEffectLane: (trackId, laneId) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (!track) return
      track.effectLanes = track.effectLanes.filter((l) => l.id !== laneId)
      for (const cell of track.cells) {
        delete cell.effectLanes[laneId]
      }
    }),

  setEffectLaneType: (trackId, laneId, newType) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (!track) return
      const lane = track.effectLanes.find((l) => l.id === laneId)
      if (lane) lane.type = newType
    }),

  addTrack: (atIndex, instrumentId) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      // Use the given instrument (caller provides it, e.g. from the cursor
      // track) — no auto-creating instruments just to add a layer.
      if (!draft.entities.instruments[instrumentId]) return
      const track = newTrack(instrumentId, pattern.length)
      draft.entities.tracks[track.id] = track
      pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
    }),

  removeTrack: (trackId) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const idx = pattern.trackIds.indexOf(trackId)
      if (idx < 0) return
      pattern.trackIds.splice(idx, 1)
      delete draft.entities.tracks[trackId]
      // Instruments are first-class now: removing a track leaves its instrument
      // in place (it may be shared, and orphan instruments are fine to keep and
      // reassign from the instruments panel).
    }),

  moveTrack: (from, to) =>
    get().mutate((draft) => {
      const ids = draft.entities.patterns[draft.patternId].trackIds
      if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return
      const [id] = ids.splice(from, 1)
      ids.splice(to, 0, id)
    }),

  copyTrack: (trackId) => {
    const { doc } = get()
    const track = doc.entities.tracks[trackId]
    if (!track) return
    // Docs are immutable snapshots, so storing the instrument by reference is
    // safe; paste clones it with fresh ids.
    set({
      trackClipboard: {
        instrument: doc.entities.instruments[track.instrumentId],
        cells: track.cells.map((c) => ({ ...c })),
      },
    })
  },

  pasteTrack: (atIndex) => {
    const snap = get().trackClipboard
    if (!snap) return
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const inst = cloneInstrument(snap.instrument, snap.instrument.name)
      const track = newTrack(inst.id, pattern.length)
      track.cells = fitCells(snap.cells, pattern.length)
      draft.entities.instruments[inst.id] = inst
      draft.entities.tracks[track.id] = track
      pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
    })
  },

  duplicateTrack: (trackId, atIndex) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const src = draft.entities.tracks[trackId]
      if (!src) return
      // Duplicating a track shares the same instrument (true reference reuse):
      // both lanes drive one instrument. Copy/paste is the "independent copy".
      const track = newTrack(src.instrumentId, pattern.length)
      track.cells = src.cells.map((c) => ({ note: c.note, volume: c.volume, noteOff: c.noteOff, effectLanes: { ...c.effectLanes } }))
      track.effectLanes = [...src.effectLanes]
      draft.entities.tracks[track.id] = track
      pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
    }),

  shiftTrack: (trackId, dir) =>
    get().mutate((draft) => {
      const cells = draft.entities.tracks[trackId]?.cells
      if (!cells || cells.length < 2) return
      if (dir === 'up') cells.push(cells.shift()!) // row 0 wraps to the bottom
      else cells.unshift(cells.pop()!) // last row wraps to the top
    }),

  toggleMute: (trackId) =>
    set((s) => ({ mutedTracks: { ...s.mutedTracks, [trackId]: !s.mutedTracks[trackId] } })),

  toggleSolo: (trackId) =>
    set((s) => ({ soloedTracks: { ...s.soloedTracks, [trackId]: !s.soloedTracks[trackId] } })),

  // --- Rectangular clipboard ---

  copyRect: (trackIds, startRow, endRow, startTrack, endTrack) => {
    const { doc } = get()
    const t0 = Math.max(0, Math.min(startTrack, endTrack))
    const t1 = Math.min(trackIds.length - 1, Math.max(startTrack, endTrack))
    const r0 = Math.max(0, Math.min(startRow, endRow))
    const r1 = Math.min(doc.entities.patterns[doc.patternId].length - 1, Math.max(startRow, endRow))
    const cells: Cell[][] = []
    for (let ti = t0; ti <= t1; ti++) {
      const track = doc.entities.tracks[trackIds[ti]]
      const col: Cell[] = []
      for (let r = r0; r <= r1; r++) {
        const c = track?.cells[r]
        col.push(c ? { note: c.note, volume: c.volume, noteOff: c.noteOff, effectLanes: { ...c.effectLanes } } : { note: null, volume: null, noteOff: false, effectLanes: {} })
      }
      cells.push(col)
    }
    set({ rectClipboard: cells })
  },

  cutRect: (trackIds, startRow, endRow, startTrack, endTrack) => {
    get().copyRect(trackIds, startRow, endRow, startTrack, endTrack)
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const t0 = Math.max(0, Math.min(startTrack, endTrack))
      const t1 = Math.min(trackIds.length - 1, Math.max(startTrack, endTrack))
      const r0 = Math.max(0, Math.min(startRow, endRow))
      const r1 = Math.min(pattern.length - 1, Math.max(startRow, endRow))
      for (let ti = t0; ti <= t1; ti++) {
        const track = draft.entities.tracks[trackIds[ti]]
        if (!track) continue
        for (let r = r0; r <= r1; r++) {
          if (track.cells[r]) {
            track.cells[r] = { note: null, volume: null, noteOff: false, effectLanes: {} }
          }
        }
      }
    })
  },

  pasteRect: (trackIds, atRow, atTrack) => {
    const clip = get().rectClipboard
    if (!clip || clip.length === 0) return
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      for (let ti = 0; ti < clip.length; ti++) {
        const targetIdx = atTrack + ti
        if (targetIdx < 0 || targetIdx >= trackIds.length) continue
        const track = draft.entities.tracks[trackIds[targetIdx]]
        if (!track) continue
        const col = clip[ti]
        for (let ri = 0; ri < col.length; ri++) {
          const targetRow = atRow + ri
          if (targetRow < 0 || targetRow >= pattern.length) continue
          track.cells[targetRow] = { ...col[ri] }
        }
      }
    })
  },

  addInstrument: (kind) => {
    let inst: Instrument
    if (kind === 'modular') inst = newModularInstrument('Modular')
    else if (kind === 'drumkit') inst = newDrumKitInstrument('Drum Kit')
    else inst = newOscInstrument('Instrument')
    get().mutate((draft) => {
      draft.entities.instruments[inst.id] = inst
      if (!draft.entities.mixerInstrumentOrder.includes(inst.id)) {
        draft.entities.mixerInstrumentOrder.push(inst.id)
      }
    })
    return inst.id
  },

  removeInstrument: (instrumentId) =>
    get().mutate((draft) => {
      // Guard: keep instruments that any track still references (the UI blocks
      // this too, but never orphan a track's instrument pointer).
      const inUse = Object.values(draft.entities.tracks).some((t) => t.instrumentId === instrumentId)
      if (inUse) return
      delete draft.entities.instruments[instrumentId]
      // Remove from mixer order too.
      const idx = draft.entities.mixerInstrumentOrder.indexOf(instrumentId)
      if (idx >= 0) draft.entities.mixerInstrumentOrder.splice(idx, 1)
    }),

  renameInstrument: (instrumentId, name) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.name = name
    }),

  setEffectSetting: (instrumentId, key, value) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst && (inst.kind === 'modular' || inst.kind === 'osc')) {
        if (!inst.effectSettings) inst.effectSettings = {}
        inst.effectSettings[key] = value
      }
    }),

  setOscParam: (instrumentId, key, value) => {
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind === 'osc' && key in inst.params) {
        ;(inst.params as Record<string, number>)[key] = value
      }
    })
    // Direct ref update so slider changes take effect without waiting for recompile.
    updateParamRef(`${instrumentId}:${key}`, value)
  },
  /** Update osc param ref immediately without triggering a recompile.
   *  Use during slider drags; call setOscParam on drag-end to persist. */
  setOscParamFast: (instrumentId: Id, key: string, value: number) => {
    updateParamRef(`${instrumentId}:${key}`, value)
  },

	  /** Like setOscParam but uses mutateSilent — persists to store + undo
	   *  without triggering a graph recompile. Use during slider drags. */
	  setOscParamSilent: (instrumentId: Id, key: string, value: number) => {
	    get().mutateSilent((draft) => {
	      const inst = draft.entities.instruments[instrumentId];
	      if (inst?.kind === 'osc' && key in inst.params) {
	        ;(inst.params as Record<string, number>)[key] = value;
	      }
	    });
	    updateParamRef(`${instrumentId}:${key}`, value);
	  },

  setTrackInstrument: (trackId, instrumentId) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && draft.entities.instruments[instrumentId]) track.instrumentId = instrumentId
    }),

  addModule: (instrumentId, type, pos) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      // Sources (note/gate) and the output sink are singletons — one per patch.
      if (MODULE_DEFS[type].singleton) return
      const id = makeId('mod')
      inst.modules[id] = { id, type, params: defaultParams(type), pos }
    }),

  removeModule: (instrumentId, moduleId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const mod = inst.modules[moduleId]
      // Never delete singletons (note/gate/output) — the patch depends on them.
      if (!mod || MODULE_DEFS[mod.type].singleton) return
      delete inst.modules[moduleId]
      for (const c of Object.values(inst.connections)) {
        if (c.from.moduleId === moduleId || c.to.moduleId === moduleId) {
          delete inst.connections[c.id]
        }
      }
    }),

  moveModule: (instrumentId, moduleId, pos) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const mod = inst.modules[moduleId]
      if (mod) mod.pos = pos
    }),

  setModuleParamFast: (_instrumentId, _moduleId, key, value) => {
    // Only update the ref — no store mutation, no compile trigger.
    // Combine instrument+module+key the same way compileModular's kconst does.
    const refKey = `${_instrumentId}:${_moduleId}:${key}`
    updateParamRef(refKey, value)
  },

  setModuleParamSilent: (instrumentId, moduleId, key, value) => {
    get().mutateSilent((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const mod = inst.modules[moduleId]
      if (mod) mod.params[key] = value
    })
    // Ref already has this value from the fast path — updateParamRef is
    // a no-op here but included for safety.
    updateParamRef(`${instrumentId}:${moduleId}:${key}`, value)
  },

  setModuleParam: (instrumentId, moduleId, key, value) => {
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const mod = inst.modules[moduleId]
      if (mod) mod.params[key] = value
    })
    updateParamRef(`${instrumentId}:${moduleId}:${key}`, value)
  },

  addConnection: (instrumentId, from, to) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      if (!inst.modules[from.moduleId] || !inst.modules[to.moduleId]) return
      // Reject cycles first — before mutating anything — so a rejected cord
      // doesn't drop the inlet's existing feeder.
      if (wouldCycle(inst.connections, from.moduleId, to.moduleId)) return
      // One cord per inlet: replace any existing feeder into this exact inlet.
      for (const c of Object.values(inst.connections)) {
        if (c.to.moduleId === to.moduleId && c.to.port === to.port) delete inst.connections[c.id]
      }
      const id = makeId('con')
      inst.connections[id] = { id, from, to, gain: 1 }
    }),

  removeConnection: (instrumentId, connectionId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      delete inst.connections[connectionId]
    }),

  setConnectionGain: (instrumentId, connectionId, gain) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const con = inst.connections[connectionId]
      if (con) con.gain = gain
    }),

  /** Ensure a modular instrument has its singleton source modules.
   *  No-op since eff modules replaced effect1/effect2 and are user-added. */
  ensureModularSingletons: (_instrumentId) => {
    // No-op: eff modules are now user-added (replaces old effect1/effect2 singletons).
  },

  duplicateInstrument: (instrumentId) => {
    const inst = get().doc.entities.instruments[instrumentId]
    if (!inst) return ''
    const clone = cloneInstrument(inst, `${inst.name} (copy)`)
    get().mutate((draft) => {
      draft.entities.instruments[clone.id] = clone
      // Add clone right after original in mixer order, or append if hidden.
      const order = draft.entities.mixerInstrumentOrder
      const origIdx = order.indexOf(instrumentId)
      if (origIdx >= 0) order.splice(origIdx + 1, 0, clone.id)
      else order.push(clone.id)
    })
    return clone.id
  },

  removeModules: (instrumentId, moduleIds) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const set = new Set(moduleIds)
      for (const mid of moduleIds) {
        const mod = inst.modules[mid]
        if (mod && !MODULE_DEFS[mod.type].singleton) delete inst.modules[mid]
      }
      for (const c of Object.values(inst.connections)) {
        if (set.has(c.from.moduleId) || set.has(c.to.moduleId)) {
          delete inst.connections[c.id]
        }
      }
    }),

  pasteModules: (instrumentId, modules, connections) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      for (const m of modules) {
        if (MODULE_DEFS[m.type].singleton) continue
        inst.modules[m.id] = m
      }
      for (const c of connections) {
        if (inst.modules[c.from.moduleId] && inst.modules[c.to.moduleId]) {
          inst.connections[c.id] = c
        }
      }
    }),

  // --- Sample management ---

  addSampleEntity: (entity) =>
    get().mutate((draft) => {
      draft.entities.samples[entity.id] = entity
    }),

  removeSampleEntity: (id) =>
    get().mutate((draft) => {
      const sample = draft.entities.samples[id]
      if (!sample) return
      // Guard: don't delete if any drumkit slot references this sample.
      for (const inst of Object.values(draft.entities.instruments)) {
        if (inst.kind === 'drumkit') {
          for (const slot of inst.slots) {
            if (slot.sampleId === id) return
          }
        }
      }
      delete draft.entities.samples[id]
    }),

  renameSample: (id, name) =>
    get().mutate((draft) => {
      const sample = draft.entities.samples[id]
      if (!sample) return
      sample.name = name.trim()
    }),

  replaceSampleAsset: (id, hash, sampleRate, channels, frames) =>
    get().mutate((draft) => {
      const sample = draft.entities.samples[id]
      if (!sample) return
      sample.hash = hash
      sample.sampleRate = sampleRate
      sample.channels = channels
      sample.frames = frames
    }),

  setVfsLoaded: (hashes) => set({ vfsLoadedHashes: hashes }),

  // --- Drum kit operations ---

  addDrumKitSlot: (instrumentId, note, sampleId, slotInstrumentId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      if (!sampleId && !slotInstrumentId) return // at least one source required
      const slot: DrumKitSlot = {
        id: makeId('slot'),
        note,
        sampleId: sampleId ?? null,
        instrumentId: slotInstrumentId ?? null,
        pitchOffset: 0,
        gain: 1,
        pan: 0,
      }
      // Insert in sorted position by note.
      const idx = inst.slots.findIndex((s) => s.note > note)
      if (idx === -1) inst.slots.push(slot)
      else inst.slots.splice(idx, 0, slot)
    }),

  removeDrumKitSlot: (instrumentId, slotId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      inst.slots = inst.slots.filter((s) => s.id !== slotId)
    }),

  setDrumKitSlotParam: (instrumentId, slotId, key, value) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      const slot = inst.slots.find((s) => s.id === slotId)
      if (!slot) return
      slot[key] = value
      // If the note changed, re-sort slots to keep them in note order.
      if (key === 'note') {
        inst.slots.sort((a, b) => a.note - b.note)
      }
    }),

  setOrPromoteSlotParam: (instrumentId, note, key, value) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      const slot = getSlotForNote(inst, note)
      if (!slot) return
      if (slot.note !== note) {
        // Inherited — promote to an explicit slot at this note, copying the
        // parent's source and defaults, then overwriting the edited param.
        const newSlot: DrumKitSlot = {
          id: makeId('slot'),
          note,
          sampleId: slot.sampleId,
          instrumentId: slot.instrumentId,
          pitchOffset: slot.pitchOffset,
          gain: slot.gain,
          pan: slot.pan,
        }
        newSlot[key] = value
        const idx = inst.slots.findIndex((s) => s.note > note)
        if (idx === -1) inst.slots.push(newSlot)
        else inst.slots.splice(idx, 0, newSlot)
      } else {
        slot[key] = value
      }
    }),

  setDrumKitSlotSource: (instrumentId, slotId, sampleId, slotInstrumentId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      const slot = inst.slots.find((s) => s.id === slotId)
      if (!slot) return
      slot.sampleId = sampleId
      slot.instrumentId = slotInstrumentId
    }),

  setDrumKitParam: (instrumentId, key, value) => {
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      if (key in inst.params) (inst.params as Record<string, number>)[key] = value
    })
    updateParamRef(`${instrumentId}:${key}`, value)
  },
  /** Update drumkit param ref immediately without triggering a recompile. */
  setDrumKitParamFast: (instrumentId: Id, key: string, value: number) => {
    updateParamRef(`${instrumentId}:${key}`, value)
  },

  setDrumKitKeyRange: (instrumentId, keyLo, keyHi) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'drumkit') return
      inst.keyLo = Math.max(0, Math.min(127, keyLo))
      inst.keyHi = Math.max(0, Math.min(127, keyHi))
    }),

  // --- Pattern operations ---

  setPatternLength: (patternId, length) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[patternId]
      if (!pattern || length < 1 || length > 256) return
      pattern.length = length
      for (const trackId of pattern.trackIds) {
        const track = draft.entities.tracks[trackId]
        if (track) track.cells = fitCells(track.cells, length)
      }
    }),

  renamePattern: (patternId, name) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[patternId]
      if (pattern) pattern.name = name
    }),

  addPattern: (name, length) => {
    const patName = name ?? `Pattern ${String(Object.keys(get().doc.entities.patterns).length + 1).padStart(2, '0')}`
    const patLen = length ?? 64
    const patternId = makeId('pat')
    get().mutate((draft) => {
      const pattern: Pattern = { id: patternId, name: patName, length: patLen, trackIds: [] }
      draft.entities.patterns[patternId] = pattern
    })
    return patternId
  },

  removePattern: (patternId) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[patternId]
      if (!pattern) return
      // Don't delete the last pattern.
      if (Object.keys(draft.entities.patterns).length <= 1) return
      // Delete tracks owned by this pattern.
      for (const trackId of pattern.trackIds) {
        delete draft.entities.tracks[trackId]
      }
      delete draft.entities.patterns[patternId]
      // Remove from all sections that reference it.
      for (const section of Object.values(draft.entities.sections)) {
        section.patternIds = section.patternIds.filter((id) => id !== patternId)
      }
      // If the deleted pattern was current, switch to the first available.
      if (draft.patternId === patternId) {
        draft.patternId = Object.keys(draft.entities.patterns)[0]
      }
    }),

  duplicatePattern: (patternId) => {
    const doc = get().doc
    const src = doc.entities.patterns[patternId]
    if (!src) return ''
    const newId = makeId('pat')
    get().mutate((draft) => {
      // Clone tracks with fresh ids, preserving cells and instrument refs.
      const newTrackIds: Id[] = []
      for (const tid of src.trackIds) {
        const srcTrack = draft.entities.tracks[tid]
        if (!srcTrack) continue
        const newTrackId = makeId('trk')
        draft.entities.tracks[newTrackId] = {
          id: newTrackId,
          instrumentId: srcTrack.instrumentId,
          cells: srcTrack.cells.map((c) => ({ note: c.note, volume: c.volume, noteOff: c.noteOff, effectLanes: { ...c.effectLanes } })),
          effectLanes: [...srcTrack.effectLanes],
        }
        newTrackIds.push(newTrackId)
      }
      const newPattern: Pattern = {
        id: newId,
        name: `${src.name} (copy)`,
        length: src.length,
        trackIds: newTrackIds,
      }
      draft.entities.patterns[newId] = newPattern
      // Add the new pattern to the first section if one exists.
      const firstSecId = draft.sectionIds[0]
      if (firstSecId && draft.entities.sections[firstSecId]) {
        draft.entities.sections[firstSecId].patternIds.push(newId)
      }
    })
    return newId
  },

  setCurrentPattern: (patternId) =>
    get().mutate((draft) => {
      if (draft.entities.patterns[patternId]) draft.patternId = patternId
    }),

  // --- Section operations ---

  addSection: (name) => {
    const sec = newSection(name ?? `Section ${Object.keys(get().doc.entities.sections).length + 1}`)
    get().mutate((draft) => {
      draft.entities.sections[sec.id] = sec
      draft.sectionIds.push(sec.id)
    })
    return sec.id
  },

  removeSection: (sectionId) =>
    get().mutate((draft) => {
      const idx = draft.sectionIds.indexOf(sectionId)
      if (idx < 0) return
      // Don't delete the last section.
      if (draft.sectionIds.length <= 1) return
      draft.sectionIds.splice(idx, 1)
      delete draft.entities.sections[sectionId]
    }),

  renameSection: (sectionId, name) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (section) section.name = name
    }),

  addPatternToSection: (sectionId, patternId, atIndex) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (!section || !draft.entities.patterns[patternId]) return
      const idx = atIndex ?? section.patternIds.length
      section.patternIds.splice(clamp(idx, 0, section.patternIds.length), 0, patternId)
    }),

  removePatternFromSection: (sectionId, patternIndex) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (!section || patternIndex < 0 || patternIndex >= section.patternIds.length) return
      section.patternIds.splice(patternIndex, 1)
    }),

  reorderSections: (fromIdx, toIdx) =>
    get().mutate((draft) => {
      const ids = draft.sectionIds
      if (fromIdx < 0 || fromIdx >= ids.length || toIdx < 0 || toIdx >= ids.length || fromIdx === toIdx) return
      const [id] = ids.splice(fromIdx, 1)
      ids.splice(toIdx, 0, id)
    }),

  reorderPatternsInSection: (sectionId, fromIdx, toIdx) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (!section) return
      const ids = section.patternIds
      if (fromIdx < 0 || fromIdx >= ids.length || toIdx < 0 || toIdx >= ids.length || fromIdx === toIdx) return
      const [id] = ids.splice(fromIdx, 1)
      ids.splice(toIdx, 0, id)
    }),

  // ── Mixer actions ──────────────────────────────────────────────

  addChannel: (_kind) => {
    const chan = createMixChannel(`Sub ${Object.keys(get().doc.entities.mixChannels).filter((id) => id !== MASTER_CHANNEL_ID).length + 1}`)
    get().mutate((draft) => { draft.entities.mixChannels[chan.id] = chan })
    return chan.id
  },

  removeChannel: (channelId) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan || chan.kind === 'master') return
      delete draft.entities.mixChannels[channelId]
      // Re-route instruments that pointed to this channel back to master.
      for (const inst of Object.values(draft.entities.instruments)) {
        if (inst.channelId === channelId) inst.channelId = MASTER_CHANNEL_ID
      }
    }),

  renameChannel: (channelId, name) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.name = name
    }),

  setChannelVolume: (channelId, vol) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.volume = vol
    }),

  setChannelVolumeFast: (channelId, vol) => {
    updateParamRef(`chan:${channelId}:volume`, vol)
  },

  setChannelPan: (channelId, pan) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.pan = pan
    }),

  setChannelMute: (channelId, mute) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.mute = mute
    }),

  setChannelSolo: (channelId, solo) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.solo = solo
    }),

  addChannelEffect: (channelId, type) => {
    if (isStereoEffect(type)) {
      const effect = createChannelEffect(type)
      get().mutate((draft) => {
        const chan = draft.entities.mixChannels[channelId]
        if (chan) chan.effects.push(effect)
      })
      return effect.id
    }
    // Mono effects → create L + R instances.
    const efL = createChannelEffect(type, 'L')
    const efR = createChannelEffect(type, 'R')
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) { chan.effects.push(efL); chan.effects.push(efR) }
    })
    return efL.id
  },

  removeChannelEffect: (channelId, effectId) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const idx = chan.effects.findIndex((e) => e.id === effectId)
      if (idx >= 0) chan.effects.splice(idx, 1)
    }),

  moveChannelEffect: (channelId, effectId, newIndex) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const idx = chan.effects.findIndex((e) => e.id === effectId)
      if (idx < 0) return
      const [item] = chan.effects.splice(idx, 1)
      chan.effects.splice(newIndex, 0, item)
    }),

  setChannelEffectParam: (channelId, effectId, key, value) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const fx = chan.effects.find((e) => e.id === effectId)
      if (fx) fx.params[key] = value
    }),

  setChannelEffectParamFast: (channelId, effectId, key, value) => {
    updateParamRef(`chan:${channelId}:${effectId}:${key}`, value)
  },

  hideInstrumentFromMixer: (instrumentId) =>
    get().mutate((draft) => {
      const order = draft.entities.mixerInstrumentOrder
      const idx = order.indexOf(instrumentId)
      if (idx >= 0) order.splice(idx, 1)
    }),

  showInstrumentInMixer: (instrumentId) =>
    get().mutate((draft) => {
      const order = draft.entities.mixerInstrumentOrder
      if (!order.includes(instrumentId)) order.push(instrumentId)
    }),

  reorderMixerInstrument: (instrumentId, newIndex) =>
    get().mutate((draft) => {
      const order = draft.entities.mixerInstrumentOrder
      const idx = order.indexOf(instrumentId)
      if (idx < 0) return
      const [id] = order.splice(idx, 1)
      order.splice(newIndex, 0, id)
    }),

  setInstrumentChannelId: (instrumentId, channelId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst && draft.entities.mixChannels[channelId]) inst.channelId = channelId
    }),

  setInstrumentPan: (instrumentId, pan) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.pan = pan
    }),

  setInstrumentPanFast: (instrumentId, pan) => {
    updateParamRef(`inst:${instrumentId}:pan`, pan)
  },

  setInstrumentPanSilent: (instrumentId, pan) => {
    get().mutateSilent((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.pan = pan
    })
    updateParamRef(`inst:${instrumentId}:pan`, pan)
  },

  setDrumKitParamSilent: (instrumentId, key, value) => {
    get().mutateSilent((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind === 'drumkit' && key in inst.params) {
        ;(inst.params as Record<string, number>)[key] = value
      }
    })
    updateParamRef(`${instrumentId}:${key}`, value)
  },

  setChannelVolumeSilent: (channelId, vol) => {
    get().mutateSilent((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.volume = vol
    })
    updateParamRef(`chan:${channelId}:volume`, vol)
  },

  setChannelPanSilent: (channelId, pan) => {
    get().mutateSilent((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.pan = pan
    })
    updateParamRef(`chan:${channelId}:pan`, pan)
  },

  setChannelEffectParamSilent: (channelId, effectId, key, value) => {
    get().mutateSilent((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const fx = chan.effects.find((e) => e.id === effectId)
      if (fx) fx.params[key] = value
    })
    updateParamRef(`chan:${channelId}:${effectId}:${key}`, value)
  },

}))

/**
 * Would adding a cord from `fromId`→`toId` create a cycle? True if `fromId` is
 * already reachable from `toId` by following existing cords (so the new edge
 * would close a loop). Keeps modular patches acyclic for the v1 compiler.
 */
function wouldCycle(
  connections: Record<Id, { from: Port; to: Port }>,
  fromId: Id,
  toId: Id,
): boolean {
  const adjacency = Object.values(connections)
  const stack = [toId]
  const seen = new Set<Id>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === fromId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const c of adjacency) {
      if (c.from.moduleId === cur) stack.push(c.to.moduleId)
    }
  }
  return false
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
