import { create } from 'zustand'
import { applyPatches, enablePatches, type Patch, produceWithPatches } from 'immer'
import type { Cell, Doc, Id, Instrument, ModuleType, Port } from '../domain/types'
import {
  cloneInstrument,
  createDefaultDoc,
  fitCells,
  makeId,
  newModularInstrument,
  newOscInstrument,
  newTrack,
} from '../domain/factory'
import { defaultParams, MODULE_DEFS } from '../domain/moduleDefs'

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
  /** Non-undoable performance state: which tracks are muted (keyed by id). */
  mutedTracks: Record<Id, boolean>

  /** Run an Immer recipe against the doc, recording it as one undoable edit. */
  mutate: (recipe: (draft: Doc) => void) => void
  undo: () => void
  redo: () => void
  /** Replace the whole document (e.g. loading a saved song). Resets history. */
  loadDoc: (doc: Doc) => void

  // --- Cell editing ---
  setCellNote: (trackId: Id, row: number, note: number | null) => void

  // --- Instrument operations (first-class, shared across tracks) ---
  addInstrument: (kind: Instrument['kind']) => Id
  removeInstrument: (instrumentId: Id) => void
  renameInstrument: (instrumentId: Id, name: string) => void
  /** Set a top-level param on an osc instrument (e.g. gain). */
  setOscParam: (instrumentId: Id, key: string, value: number) => void
  /** Point a track at any existing instrument. */
  setTrackInstrument: (trackId: Id, instrumentId: Id) => void

  // --- Modular graph editing (on a modular instrument) ---
  addModule: (instrumentId: Id, type: ModuleType, pos: { x: number; y: number }) => void
  removeModule: (instrumentId: Id, moduleId: Id) => void
  moveModule: (instrumentId: Id, moduleId: Id, pos: { x: number; y: number }) => void
  setModuleParam: (instrumentId: Id, moduleId: Id, key: string, value: number) => void
  addConnection: (instrumentId: Id, from: Port, to: Port) => void
  removeConnection: (instrumentId: Id, connectionId: Id) => void
  setConnectionGain: (instrumentId: Id, connectionId: Id, gain: number) => void

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
}

const HISTORY_LIMIT = 200

export const useDocStore = create<DocState>((set, get) => ({
  doc: createDefaultDoc(),
  past: [],
  future: [],
  trackClipboard: null,
  mutedTracks: {},

  mutate: (recipe) => {
    const { doc, past } = get()
    const [next, patches, inverse] = produceWithPatches(doc, recipe)
    if (patches.length === 0) return // no-op edit, don't pollute history
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(1) : past
    set({ doc: next, past: [...trimmed, { patches, inverse }], future: [] })
  },

  loadDoc: (doc) => set({ doc, past: [], future: [], trackClipboard: null, mutedTracks: {} }),

  undo: () => {
    const { doc, past, future } = get()
    const entry = past[past.length - 1]
    if (!entry) return
    set({ doc: applyPatches(doc, entry.inverse), past: past.slice(0, -1), future: [entry, ...future] })
  },

  redo: () => {
    const { doc, past, future } = get()
    const entry = future[0]
    if (!entry) return
    set({ doc: applyPatches(doc, entry.patches), past: [...past, entry], future: future.slice(1) })
  },

  setCellNote: (trackId, row, note) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && track.cells[row]) track.cells[row].note = note
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
      track.cells = src.cells.map((c) => ({ ...c }))
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

  addInstrument: (kind) => {
    const inst = kind === 'modular' ? newModularInstrument('Modular') : newOscInstrument('Instrument')
    get().mutate((draft) => {
      draft.entities.instruments[inst.id] = inst
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
    }),

  renameInstrument: (instrumentId, name) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.name = name
    }),

  setOscParam: (instrumentId, key, value) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind === 'osc' && key in inst.params) {
        ;(inst.params as Record<string, number>)[key] = value
      }
    }),

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

  setModuleParam: (instrumentId, moduleId, key, value) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind !== 'modular') return
      const mod = inst.modules[moduleId]
      if (mod) mod.params[key] = value
    }),

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
