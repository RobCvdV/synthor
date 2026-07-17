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
  /** AudioContext.currentTime when playback was last started (for playhead alignment). */
  startTime: number

  play: (atTime: number) => void
  stop: () => void
  toggle: (atTime: number) => void
  setBpm: (bpm: number) => void
}

export const useTransportStore = create<TransportState>((set) => ({
  playing: false,
  bpm: 120,
  linesPerBeat: 4,
  startTime: 0,

  play: (atTime) => set({ playing: true, startTime: atTime }),
  stop: () => set({ playing: false }),
  toggle: (atTime) => set((s) => ({ playing: !s.playing, startTime: s.playing ? s.startTime : atTime })),
  setBpm: (bpm) => set({ bpm }),
}))

/** Rows advanced per second, derived from tempo. */
export function rowHz(bpm: number, linesPerBeat: number): number {
  return (bpm / 60) * linesPerBeat
}
