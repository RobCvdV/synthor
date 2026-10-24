import { MAX_BPM, MIN_BPM } from '../domain/types'
import type { DocState } from './docStore'

export interface TempoOps {
  /** Song tempo in BPM, clamped to MIN_BPM..MAX_BPM. One undoable edit. */
  setBpm: (bpm: number) => void
  /** Rows per beat (≥ 1). One undoable edit. */
  setLinesPerBeat: (linesPerBeat: number) => void
}

export function tempoOps(get: () => DocState): TempoOps {
  return {
    setBpm: (bpm) => {
      if (!Number.isFinite(bpm)) return
      get().mutate((draft) => { draft.tempo.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) })
    },
    setLinesPerBeat: (linesPerBeat) => {
      if (!Number.isFinite(linesPerBeat)) return
      get().mutate((draft) => { draft.tempo.linesPerBeat = Math.max(1, Math.round(linesPerBeat)) })
    },
  }
}
