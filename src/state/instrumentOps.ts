import { MAX_LIVE_VOICES, type Id, type Instrument, type InstrumentLibraryInfo } from '../domain/types'
import { normalizeTags } from '../domain/library'
import { cloneInstrument, newDrumKitInstrument, newEmptyModularInstrument, newModularInstrument } from '../domain/factory'
import type { DocState } from './docStore'

export interface InstrumentOps {
  addInstrument: (kind: Instrument['kind']) => Id
  /** A named empty synth (fixed sources + output only) or an empty drum kit. */
  addEmptyInstrument: (kind: Instrument['kind'], name: string) => Id
  removeInstrument: (instrumentId: Id) => void
  renameInstrument: (instrumentId: Id, name: string) => void
  /** Updates the library attributes the instrument keeps in the song (category, tags, library link). */
  setInstrumentLibraryInfo: (instrumentId: Id, patch: Partial<InstrumentLibraryInfo>) => void
  /** Set an effect range max value on an instrument. */
  setEffectSetting: (instrumentId: Id, key: string, value: number) => void
  /** Live (free play) polyphony of a modular instrument, 1..MAX_LIVE_VOICES. */
  setInstrumentVoices: (instrumentId: Id, voices: number) => void
  setTrackInstrument: (trackId: Id, instrumentId: Id) => void
  /** Duplicate an existing instrument (deep-clone with fresh ids). */
  duplicateInstrument: (instrumentId: Id) => Id
}

export function instrumentOps(get: () => DocState): InstrumentOps {
  const insertInstrument = (inst: Instrument): Id => {
    get().mutate((draft) => {
      draft.entities.instruments[inst.id] = inst
      if (!draft.entities.mixerInstrumentOrder.includes(inst.id)) draft.entities.mixerInstrumentOrder.push(inst.id)
    })
    return inst.id
  }

  return {
    addInstrument: (kind) =>
      insertInstrument(kind === 'drumkit' ? newDrumKitInstrument('Drum Kit') : newModularInstrument('Synth')),

    addEmptyInstrument: (kind, name) =>
      insertInstrument(kind === 'drumkit' ? newDrumKitInstrument(name) : newEmptyModularInstrument(name)),

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

    setInstrumentLibraryInfo: (instrumentId, patch) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (!inst) return
        const current = inst.library ?? { category: '', tags: [] }
        const next: InstrumentLibraryInfo = {
          ...current,
          ...patch,
          category: (patch.category ?? current.category).trim(),
          tags: normalizeTags(patch.tags ?? current.tags),
        }
        if (next.id === undefined) delete next.id
        inst.library = next
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

    setInstrumentVoices: (instrumentId, voices) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind === 'modular') inst.voices = Math.max(1, Math.min(MAX_LIVE_VOICES, Math.round(voices)))
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
