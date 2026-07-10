import { create } from 'zustand'

/**
 * Transport / playhead state. Deliberately separate from the document store:
 * moving the playhead or toggling play must never touch undo history.
 */
interface TransportState {
  playing: boolean
  bpm: number
  /** Rows per beat (4 = sixteenth-note grid). */
  linesPerBeat: number

  play: () => void
  stop: () => void
  toggle: () => void
  setBpm: (bpm: number) => void
}

export const useTransportStore = create<TransportState>((set) => ({
  playing: false,
  bpm: 120,
  linesPerBeat: 4,

  play: () => set({ playing: true }),
  stop: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: !s.playing })),
  setBpm: (bpm) => set({ bpm }),
}))

/** Rows advanced per second, derived from tempo. */
export function rowHz(bpm: number, linesPerBeat: number): number {
  return (bpm / 60) * linesPerBeat
}
