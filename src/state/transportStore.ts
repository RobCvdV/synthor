import { create } from 'zustand'

/**
 * Transport / playhead state. Deliberately separate from the document store:
 * moving the playhead or toggling play must never touch undo history.
 *
 * Play mode lives in appStore so it persists across sessions.
 */
interface TransportState {
  playing: boolean
  bpm: number
  /** Rows per beat (4 = sixteenth-note grid). */
  linesPerBeat: number
  /** AudioContext.currentTime when playback was last started (for playhead alignment). */
  startTime: number
  /** Pattern row at which playback was started (0 = top, or cursor row for play-from-cursor). */
  startRow: number
  /** Incremented on each play start so the audio graph gets fresh clock/seq2 nodes. */
  playEpoch: number
  /** Current global row reported by the scheduler (for UI playhead). */
  currentRow: number

  play: (atTime: number, startRow?: number) => void
  stop: () => void
  toggle: (atTime: number, startRow?: number) => void
  setBpm: (bpm: number) => void
  setCurrentRow: (row: number) => void
}

export const useTransportStore = create<TransportState>((set) => ({
  playing: false,
  bpm: 120,
  linesPerBeat: 4,
  startTime: 0,
  startRow: 0,
  playEpoch: 0,
  currentRow: 0,

  play: (atTime, startRow = 0) => set((s) => ({
    playing: true,
    startTime: atTime,
    startRow,
    playEpoch: s.playEpoch + 1,
    currentRow: startRow,
  })),
  stop: () => set({ playing: false, currentRow: 0 }),
  toggle: (atTime, startRow = 0) => set((s) => ({
    playing: !s.playing,
    startTime: s.playing ? s.startTime : atTime,
    startRow: s.playing ? s.startRow : startRow,
    playEpoch: s.playing ? s.playEpoch : s.playEpoch + 1,
    currentRow: s.playing ? 0 : startRow,
  })),
  setBpm: (bpm) => set({ bpm }),
  setCurrentRow: (currentRow) => set({ currentRow }),
}))

/** Rows advanced per second, derived from tempo. */
export function rowHz(bpm: number, linesPerBeat: number): number {
  return (bpm / 60) * linesPerBeat
}
