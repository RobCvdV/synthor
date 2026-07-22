import { create } from 'zustand'
import type { Id } from '../domain/types'

/** Raw MIDI input port descriptor (subset of Web MIDI API MIDIInput). */
export interface MidiPort {
  id: string
  name: string
}

interface MidiState {
  /** Currently available MIDI input ports. */
  inputs: MidiPort[]
  /** User-selected input port id. */
  selectedInputId: string | null
  /** Whether at least one port is open and listening. */
  connected: boolean
  /** Which instrument receives MIDI note events. */
  activeInstrumentId: Id | null

  /** Last-seen CC value per controller number (0–127).  Missing = not yet received. */
  ccValues: Record<number, number>
  /** Last pitch-bend value, normalised -1 … +1. */
  pitchBend: number

  setInputs: (inputs: MidiPort[]) => void
  setSelectedInput: (id: string | null) => void
  setConnected: (c: boolean) => void
  setActiveInstrument: (id: Id | null) => void
  setCcValue: (cc: number, value: number) => void
  setPitchBend: (value: number) => void
}

export const useMidiStore = create<MidiState>((set) => ({
  inputs: [],
  selectedInputId: null,
  connected: false,
  activeInstrumentId: null,

  ccValues: {},
  pitchBend: 0,

  setInputs: (inputs) => set({ inputs }),
  setSelectedInput: (id) => set({ selectedInputId: id }),
  setConnected: (c) => set({ connected: c }),
  setActiveInstrument: (id) => set({ activeInstrumentId: id }),
  setCcValue: (cc, value) =>
    set((s) => ({ ccValues: { ...s.ccValues, [cc]: value } })),
  setPitchBend: (value) => set({ pitchBend: value }),
}))
