import { create } from 'zustand'

/** A file the app is waiting on. */
export interface StorageWait {
  path: string
  since: number
  /** Concurrent reads of the same file. */
  reads: number
  /** iCloud had moved it off the Mac and is downloading it. */
  cloud: boolean
}

interface StorageStatusState {
  waits: Record<string, StorageWait>
  beginRead: (path: string, now: number) => void
  endRead: (path: string) => void
  /** The main process found the file evicted to iCloud. */
  markCloud: (path: string) => void
}

/** Transient read bookkeeping behind the "waiting for the library" banner. */
export const useStorageStatus = create<StorageStatusState>((set) => ({
  waits: {},
  beginRead: (path, now) => set(({ waits }) => {
    const w = waits[path]
    return { waits: { ...waits, [path]: w ? { ...w, reads: w.reads + 1 } : { path, since: now, reads: 1, cloud: false } } }
  }),
  endRead: (path) => set(({ waits }) => {
    const w = waits[path]
    if (!w) return {}
    const { [path]: _, ...rest } = waits
    return { waits: w.reads > 1 ? { ...waits, [path]: { ...w, reads: w.reads - 1 } } : rest }
  }),
  markCloud: (path) => set(({ waits }) => {
    const w = waits[path]
    return w && !w.cloud ? { waits: { ...waits, [path]: { ...w, cloud: true } } } : {}
  }),
}))

/** The longest-running wait, or null when nothing is pending. */
export function oldestWait(waits: Record<string, StorageWait>): StorageWait | null {
  let oldest: StorageWait | null = null
  for (const w of Object.values(waits)) if (!oldest || w.since < oldest.since) oldest = w
  return oldest
}
