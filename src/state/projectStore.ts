import { create } from 'zustand'
import { slugify } from '../persist/opfsStore'

/**
 * Identity + save status of the currently-open song (project). Kept separate
 * from the doc store because none of this is part of the undoable document,
 * and separate from transport because it isn't performance state either.
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface ProjectState {
  name: string
  /** Stable OPFS directory slug — set once at creation/load, never changes on rename. */
  slug: string
  /** ISO timestamp the current song was first created. */
  createdAt: string
  status: SaveStatus
  /** ISO timestamp of the last successful save, or null. */
  lastSavedAt: string | null

  setName: (name: string) => void
  markDirty: () => void
  markSaving: () => void
  markSaved: (at: string) => void
  markError: () => void
  /** Reset identity for a freshly-created or freshly-loaded song. */
  reset: (name: string, createdAt: string, slug?: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  name: 'Untitled',
  slug: 'untitled',
  createdAt: new Date().toISOString(),
  status: 'idle',
  lastSavedAt: null,

  setName: (name) => set({ name, status: 'dirty' }),
  markDirty: () => set({ status: 'dirty' }),
  markSaving: () => set({ status: 'saving' }),
  markSaved: (at) => set({ status: 'saved', lastSavedAt: at }),
  markError: () => set({ status: 'error' }),
  reset: (name, createdAt, slug) =>
    set({ name, createdAt, status: 'idle', lastSavedAt: null, slug: slug ?? slugify(name) }),
}))
