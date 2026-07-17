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
  /** OPFS directory slug — derived from the current name. */
  slug: string
  /** The slug of the last successful save. Used to detect renames and move
   *  the OPFS directory when the song is saved under a new name. */
  savedSlug: string | null
  /** ISO timestamp the current song was first created. */
  createdAt: string
  status: SaveStatus
  /** ISO timestamp of the last successful save, or null. */
  lastSavedAt: string | null

  setName: (name: string) => void
  /** Set the slug explicitly (used after a successful rename-move in OPFS). */
  setSlug: (slug: string) => void
  markDirty: () => void
  markSaving: () => void
  /** Record a successful save, updating the saved slug so the next rename is detected. */
  markSaved: (at: string) => void
  markError: () => void
  /** Reset identity for a freshly-created or freshly-loaded song. */
  reset: (name: string, createdAt: string, slug?: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  name: 'Untitled',
  slug: 'untitled',
  savedSlug: null,
  createdAt: new Date().toISOString(),
  status: 'idle',
  lastSavedAt: null,

  setName: (name) => set((s) => ({ name, slug: slugify(name), status: s.status === 'idle' ? 'dirty' : s.status })),
  setSlug: (slug) => set({ slug, savedSlug: slug }),
  markDirty: () => set({ status: 'dirty' }),
  markSaving: () => set({ status: 'saving' }),
  markSaved: (at) => set((s) => ({ status: 'saved', lastSavedAt: at, savedSlug: s.slug })),
  markError: () => set({ status: 'error' }),
  reset: (name, createdAt, slug) => {
    const s = slug ?? slugify(name)
    return set({ name, createdAt, status: 'idle', lastSavedAt: null, slug: s, savedSlug: s })
  },
}))
