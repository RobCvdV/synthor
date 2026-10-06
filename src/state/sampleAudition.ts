import { create } from 'zustand'
import type { PcmData } from '../audio/sampleEdit'
import type { Id } from '../domain/types'

/**
 * Audio a sample is being tuned to in the sample editor — transient, never persisted or undoable.
 * Everything that plays the sample (instruments, drum kits, note keys) plays this instead until
 * the edit is done or cancelled.
 */
export interface SampleAudition {
  sampleId: Id
  /** The stored content this stands in for. */
  hash: string
  data: PcmData
  original: PcmData
  sampleRate: number
  /** Bumped on every change, so each version gets its own VFS key. */
  version: number
}

interface SampleAuditionState {
  audition: SampleAudition | null
  setAudition: (a: Omit<SampleAudition, 'version'>) => void
  clearAudition: () => void
}

let version = 0

export const useSampleAudition = create<SampleAuditionState>((set) => ({
  audition: null,
  setAudition: (a) => set({ audition: { ...a, version: ++version } }),
  clearAudition: () => set({ audition: null }),
}))
