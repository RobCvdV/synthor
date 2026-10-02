import { create } from 'zustand'

/** Whether the Open Song dialog is showing (File > Open, ⌘O). */
export const useSongBrowserStore = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
