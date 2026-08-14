import { create } from 'zustand'
import type { PcmData } from '../audio/sampleEdit'

/**
 * Sample paste buffer — transient, never persisted, never part of undo history
 * (like previewStore). Holds decoded PCM so copy/cut survive view switches.
 */
export interface SampleClipboard {
  data: PcmData
  sampleRate: number
  channels: number
  frames: number
}

interface SampleClipboardState {
  pb: SampleClipboard | null
  setClipboard: (pb: SampleClipboard | null) => void
}

export const useSampleClipboard = create<SampleClipboardState>((set) => ({
  pb: null,
  setClipboard: (pb) => set({ pb }),
}))
