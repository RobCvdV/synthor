import { create } from 'zustand'
import { applyPatches, enablePatches, type Patch, produceWithPatches } from 'immer'
import type { Doc, Id } from '../domain/types'
import { createDefaultDoc } from '../domain/factory'

enablePatches()

/** One undoable step: forward patches and their inverse. */
interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
}

interface DocState {
  doc: Doc
  past: HistoryEntry[]
  future: HistoryEntry[]

  /** Run an Immer recipe against the doc, recording it as one undoable edit. */
  mutate: (recipe: (draft: Doc) => void) => void
  undo: () => void
  redo: () => void

  // --- Domain actions (thin wrappers over mutate) ---
  setCellNote: (trackId: Id, row: number, note: number | null) => void
}

const HISTORY_LIMIT = 200

export const useDocStore = create<DocState>((set, get) => ({
  doc: createDefaultDoc(),
  past: [],
  future: [],

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
    set({
      doc: applyPatches(doc, entry.inverse),
      past: past.slice(0, -1),
      future: [entry, ...future],
    })
  },

  redo: () => {
    const { doc, past, future } = get()
    const entry = future[0]
    if (!entry) return
    set({
      doc: applyPatches(doc, entry.patches),
      past: [...past, entry],
      future: future.slice(1),
    })
  },

  setCellNote: (trackId, row, note) =>
    get().mutate((draft) => {
      const track = draft.entities.tracks[trackId]
      if (track && track.cells[row]) track.cells[row].note = note
    }),
}))
