import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import type { Doc } from '../domain/types'
import { clearParamRefs } from '../audio/paramRefs'
import { createDefaultDoc } from '../domain/factory'
import type { HistoryEntry, RectClipboard, TrackSnapshot } from './docStoreTypes'
import { trackerOps, type TrackerOps } from './trackerOps'
import { trackOps, type TrackOps } from './trackOps'
import { instrumentOps, type InstrumentOps } from './instrumentOps'
import { modularOps, type ModularOps } from './modularOps'
import { sampleOps, type SampleOps } from './sampleOps'
import { drumkitOps, type DrumkitOps } from './drumkitOps'
import { arrangementOps, type ArrangementOps } from './arrangementOps'
import { mixerOps, type MixerOps } from './mixerOps'

enablePatches()

interface CoreOps {
  /** Like mutate, but sets silentBatch so subscribers can skip the compile.
   *  Use for slider release — persist to store + undo without recompile. */
  mutateSilent: (recipe: (draft: Doc) => void) => void
  /** Store which sample hashes loaded into VFS after a sync. */
  setVfsLoaded: (hashes: Set<string>) => void
  /** Run an Immer recipe against the doc, recording it as one undoable edit. */
  mutate: (recipe: (draft: Doc) => void) => void
  undo: () => void
  redo: () => void
  /** Replace the whole document (e.g. loading a saved song). Resets history. */
  loadDoc: (doc: Doc) => void
}

export interface DocState extends CoreOps, TrackerOps, TrackOps, InstrumentOps, ModularOps, SampleOps, DrumkitOps, ArrangementOps, MixerOps {
  doc: Doc
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Non-undoable scratch space for track copy/paste. */
  trackClipboard: TrackSnapshot | null
  /** Non-undoable scratch space for rectangular cell copy/paste. */
  rectClipboard: RectClipboard | null
  /** When true, docStore subscribers skip their side effects — used by
   *  mutateSilent to persist values without triggering graph recompiles. */
  silentBatch: boolean
  /** Hashes of samples that loaded successfully into VFS. null = not yet synced. */
  vfsLoadedHashes: Set<string> | null
}

const HISTORY_LIMIT = 200

export const useDocStore = create<DocState>((set, get) => ({
  doc: createDefaultDoc(),
  past: [],
  future: [],
  trackClipboard: null,
  rectClipboard: null,
  vfsLoadedHashes: null,
  silentBatch: false,


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
    set({ doc, past: [], future: [], trackClipboard: null, rectClipboard: null, vfsLoadedHashes: null }),

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

  ...trackerOps(get),
  ...trackOps(set, get),
  ...instrumentOps(get),
  ...modularOps(get),
  ...sampleOps(get),
  ...drumkitOps(get),
  ...arrangementOps(get),
  ...mixerOps(get),

  setVfsLoaded: (hashes) => set({ vfsLoadedHashes: hashes }),
}))
