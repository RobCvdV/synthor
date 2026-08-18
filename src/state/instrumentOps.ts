import type { Id, Instrument } from '../domain/types'
import { cloneInstrument, newDrumKitInstrument, newModularInstrument } from '../domain/factory'
import type { DocState } from './docStore'

export interface InstrumentOps {
  addInstrument: (kind: Instrument['kind']) => Id
  removeInstrument: (instrumentId: Id) => void
  renameInstrument: (instrumentId: Id, name: string) => void
  /** Set an effect range max value on an instrument. */
  setEffectSetting: (instrumentId: Id, key: string, value: number) => void
  setTrackInstrument: (trackId: Id, instrumentId: Id) => void
  /** Duplicate an existing instrument (deep-clone with fresh ids). */
  duplicateInstrument: (instrumentId: Id) => Id
}

export function instrumentOps(get: () => DocState): InstrumentOps {
  return {
    addInstrument: (kind) => {
      const inst: Instrument =
        kind === 'drumkit' ? newDrumKitInstrument('Drum Kit') : newModularInstrument('Synth')
      get().mutate((draft) => {
        draft.entities.instruments[inst.id] = inst
        if (!draft.entities.mixerInstrumentOrder.includes(inst.id)) {
          draft.entities.mixerInstrumentOrder.push(inst.id)
        }
      })
      return inst.id
    },

    removeInstrument: (instrumentId) =>
      get().mutate((draft) => {
        // Guard: keep instruments that any track still references (the UI blocks
        // this too, but never orphan a track's instrument pointer).
        const inUse = Object.values(draft.entities.tracks).some((t) => t.instrumentId === instrumentId)
        if (inUse) return
        delete draft.entities.instruments[instrumentId]
        // Remove from mixer order too.
        const idx = draft.entities.mixerInstrumentOrder.indexOf(instrumentId)
        if (idx >= 0) draft.entities.mixerInstrumentOrder.splice(idx, 1)
      }),

    renameInstrument: (instrumentId, name) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst) inst.name = name
      }),

    setEffectSetting: (instrumentId, key, value) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind === 'modular') {
          if (!inst.effectSettings) inst.effectSettings = {}
          inst.effectSettings[key] = value
        }
      }),

    setTrackInstrument: (trackId, instrumentId) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (track && draft.entities.instruments[instrumentId]) track.instrumentId = instrumentId
      }),

    duplicateInstrument: (instrumentId) => {
      const inst = get().doc.entities.instruments[instrumentId]
      if (!inst) return ''
      const clone = cloneInstrument(inst, `${inst.name} (copy)`)
      get().mutate((draft) => {
        draft.entities.instruments[clone.id] = clone
        // Add clone right after original in mixer order, or append if hidden.
        const order = draft.entities.mixerInstrumentOrder
        const origIdx = order.indexOf(instrumentId)
        if (origIdx >= 0) order.splice(origIdx + 1, 0, clone.id)
        else order.push(clone.id)
      })
      return clone.id
    },
  }
}
