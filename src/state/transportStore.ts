import { create } from 'zustand'

export type PlayMode = 'song' | 'section' | 'pattern'
export const PLAY_MODES: PlayMode[] = ['song', 'section', 'pattern']

/**
 * Transport / playhead state. Deliberately separate from the document store:
 * moving the playhead or toggling play must never touch undo history.
 */
interface TransportState {
  playing: boolean
  /** Play mode: loop the current pattern, current section, or full song. */
  playMode: PlayMode
  bpm: number
  /** Rows per beat (4 = sixteenth-note grid). */
  linesPerBeat: number
  /** AudioContext.currentTime when playback was last started (for playhead alignment). */
  startTime: number
  /** Pattern row at which playback started (0 = top, or cursor row for play-from-cursor). */
  startRow: number
  /** Incremented on each play start so the audio graph gets fresh clock/seq2 nodes. */
  playEpoch: number

  play: (atTime: number, startRow?: number) => void
  stop: () => void
  toggle: (atTime: number, startRow?: number) => void
  setBpm: (bpm: number) => void
  setPlayMode: (mode: PlayMode) => void
  cyclePlayMode: () => void
}

export const useTransportStore = create<TransportState>((set) => ({
  playing: false,
  playMode: 'pattern',
  bpm: 120,
  linesPerBeat: 4,
  startTime: 0,
  startRow: 0,
  playEpoch: 0,

  play: (atTime, startRow = 0) => set((s) => ({
    playing: true,
    startTime: atTime,
    startRow,
    playEpoch: s.playEpoch + 1,
  })),
  stop: () => set({ playing: false }),
  toggle: (atTime, startRow = 0) => set((s) => ({
    playing: !s.playing,
    startTime: s.playing ? s.startTime : atTime,
    startRow: s.playing ? s.startRow : startRow,
    playEpoch: s.playing ? s.playEpoch : s.playEpoch + 1,
  })),
  setBpm: (bpm) => set({ bpm }),
  setPlayMode: (playMode) => set({ playMode }),
  cyclePlayMode: () => set((s) => {
    const idx = PLAY_MODES.indexOf(s.playMode)
    return { playMode: PLAY_MODES[(idx + 1) % PLAY_MODES.length] }
  }),
}))

/** Rows advanced per second, derived from tempo. */
export function rowHz(bpm: number, linesPerBeat: number): number {
  return (bpm / 60) * linesPerBeat
}
