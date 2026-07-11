import { create } from 'zustand'
import { applyPatches, enablePatches, type Patch, produceWithPatches } from 'immer'
import type { Cell, Doc, Id, Instrument } from '../domain/types'
import { createDefaultDoc, fitCells, newOscInstrument, newTrack } from '../domain/factory'

enablePatches()

/** One undoable step: forward patches and their inverse. */
interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
}

/** A detached copy of a track + its instrument, for copy/paste. */
interface TrackSnapshot {
  instrument: { kind: Instrument['kind']; name: string; params: Instrument['params'] }
  cells: Cell[]
}

interface DocState {
  doc: Doc
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Non-undoable scratch space for track copy/paste. */
  trackClipboard: TrackSnapshot | null

  /** Run an Immer recipe against the doc, recording it as one undoable edit. */
  mutate: (recipe: (draft: Doc) => void) => void
  undo: () => void
  redo: () => void

  // --- Cell editing ---
  setCellNote: (trackId: Id, row: number, note: number | null) => void

  // --- Track operations (atIndex = position within the current pattern) ---
  addTrack: (atIndex: number) => void
  removeTrack: (trackId: Id) => void
  moveTrack: (from: number, to: number) => void
  copyTrack: (trackId: Id) => void
  pasteTrack: (atIndex: number) => void
  duplicateTrack: (trackId: Id, atIndex: number) => void
}

const HISTORY_LIMIT = 200

export const useDocStore = create<DocState>((set, get) => ({
  doc: createDefaultDoc(),
  past: [],
  future: [],
  trackClipboard: null,

  mutate: (recipe) => {
    const { doc, past } = get()
    const [next, patches, inverse] = produceWithPatches(doc, recipe)
    if (patches.length === 0) return // no-op edit, don't pollute history
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(1) : past
    set({ doc: next, past: [...trimmed, { patches, inverse }], future: [] })
  },

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

  addTrack: (atIndex) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const inst = newOscInstrument(`Track ${pattern.trackIds.length + 1}`)
      const track = newTrack(inst.id, pattern.length)
      draft.entities.instruments[inst.id] = inst
      draft.entities.tracks[track.id] = track
      pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
    }),

  removeTrack: (trackId) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const idx = pattern.trackIds.indexOf(trackId)
      if (idx < 0) return
      pattern.trackIds.splice(idx, 1)
      const instId = draft.entities.tracks[trackId]?.instrumentId
      delete draft.entities.tracks[trackId]
      // Drop the instrument too if nothing else references it.
      if (instId && !Object.values(draft.entities.tracks).some((t) => t.instrumentId === instId)) {
        delete draft.entities.instruments[instId]
      }
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
    const inst = doc.entities.instruments[track.instrumentId]
    set({
      trackClipboard: {
        instrument: { kind: inst.kind, name: inst.name, params: { ...inst.params } },
        cells: track.cells.map((c) => ({ ...c })),
      },
    })
  },

  pasteTrack: (atIndex) => {
    const snap = get().trackClipboard
    if (!snap) return
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[draft.patternId]
      const inst = newOscInstrument(snap.instrument.name)
      inst.kind = snap.instrument.kind
      inst.params = { ...snap.instrument.params }
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
      const srcInst = draft.entities.instruments[src.instrumentId]
      const inst = newOscInstrument(`${srcInst.name} copy`)
      inst.kind = srcInst.kind
      inst.params = { ...srcInst.params }
      const track = newTrack(inst.id, pattern.length)
      track.cells = src.cells.map((c) => ({ ...c }))
      draft.entities.instruments[inst.id] = inst
      draft.entities.tracks[track.id] = track
      pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
    }),
}))

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
