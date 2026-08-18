import { create } from 'zustand'

/** Audio bring-up state for the play-button cue. Transient, never persisted. */
export type AudioStatus = 'idle' | 'warming' | 'ready'

interface AudioState {
  /** idle = no user gesture yet (AudioContext can't start), warming = host
   *  starting / samples syncing / graph rendering, ready = play is instant. */
  status: AudioStatus
  /** True once the scheduler clock actually started the current session —
   *  distinguishes armed (transport playing, graph still coming up) from live. */
  playbackStarted: boolean
  setStatus: (status: AudioStatus) => void
  setPlaybackStarted: (started: boolean) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  status: 'idle',
  playbackStarted: false,
  setStatus: (status) => set({ status }),
  setPlaybackStarted: (playbackStarted) => set({ playbackStarted }),
}))
