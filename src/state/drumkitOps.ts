import type { DrumKitSlot, Id } from '../domain/types'
import { getSlotForNote } from '../domain/types'
import { makeId } from '../domain/factory'
import { updateParamRef } from '../audio/paramRefs'
import type { DocState } from './docStore'

export interface DrumkitOps {
  addDrumKitSlot: (instrumentId: Id, note: number, sampleId?: Id, slotInstrumentId?: Id) => void
  removeDrumKitSlot: (instrumentId: Id, slotId: Id) => void
  setDrumKitSlotParam: (instrumentId: Id, slotId: Id, key: 'note' | 'baseNote' | 'volume' | 'pan', value: number) => void
  /** Set a param on the slot at the given note. If the slot is inherited,
   *  promotes it (copies parent source) and sets the param in one undo step. */
  setOrPromoteSlotParam: (instrumentId: Id, note: number, key: 'baseNote' | 'volume' | 'pan', value: number) => void
  setDrumKitSlotSource: (instrumentId: Id, slotId: Id, sampleId: Id | null, slotInstrumentId: Id | null) => void
  setDrumKitParam: (instrumentId: Id, key: string, value: number) => void
  setDrumKitParamFast: (instrumentId: Id, key: string, value: number) => void
  setDrumKitKeyRange: (instrumentId: Id, keyLo: number, keyHi: number) => void
  setDrumKitParamSilent: (instrumentId: Id, key: string, value: number) => void
}

export function drumkitOps(get: () => DocState): DrumkitOps {
  return {
    addDrumKitSlot: (instrumentId, note, sampleId, slotInstrumentId) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        if (!sampleId && !slotInstrumentId) return // at least one source required
        const slot: DrumKitSlot = {
          id: makeId('slot'),
          note,
          sampleId: sampleId ?? null,
          instrumentId: slotInstrumentId ?? null,
          baseNote: 60,
          volume: 1,
          pan: 0,
        }
        // Insert in sorted position by note.
        const idx = inst.slots.findIndex((s) => s.note > note)
        if (idx === -1) inst.slots.push(slot)
        else inst.slots.splice(idx, 0, slot)
      }),

    removeDrumKitSlot: (instrumentId, slotId) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        inst.slots = inst.slots.filter((s) => s.id !== slotId)
      }),

    setDrumKitSlotParam: (instrumentId, slotId, key, value) => {
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        const slot = inst.slots.find((s) => s.id === slotId)
        if (!slot) return
        slot[key] = value
        // If the note changed, re-sort slots to keep them in note order.
        if (key === 'note') {
          inst.slots.sort((a, b) => a.note - b.note)
        }
      })
      updateParamRef(`${instrumentId}:slot:${slotId}:${key}`, value)
    },

    setOrPromoteSlotParam: (instrumentId, note, key, value) => {
      let effectiveSlotId: string | undefined
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        const slot = getSlotForNote(inst, note)
        if (!slot) return
        if (slot.note !== note) {
          // Inherited — promote to an explicit slot at this note, copying the
          // parent's source and defaults, then overwriting the edited param.
          const newSlot: DrumKitSlot = {
            id: makeId('slot'),
            note,
            sampleId: slot.sampleId,
            instrumentId: slot.instrumentId,
            baseNote: slot.baseNote,
            volume: slot.volume,
            pan: slot.pan,
          }
          newSlot[key] = value
          const idx = inst.slots.findIndex((s) => s.note > note)
          if (idx === -1) inst.slots.push(newSlot)
          else inst.slots.splice(idx, 0, newSlot)
          effectiveSlotId = newSlot.id
        } else {
          slot[key] = value
          effectiveSlotId = slot.id
        }
      })
      if (effectiveSlotId) {
        updateParamRef(`${instrumentId}:slot:${effectiveSlotId}:${key}`, value)
      }
    },

    setDrumKitSlotSource: (instrumentId, slotId, sampleId, slotInstrumentId) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        const slot = inst.slots.find((s) => s.id === slotId)
        if (!slot) return
        slot.sampleId = sampleId
        slot.instrumentId = slotInstrumentId
      }),

    setDrumKitParam: (instrumentId, key, value) => {
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        if (key in inst.params) (inst.params as Record<string, number>)[key] = value
      })
      updateParamRef(`${instrumentId}:${key}`, value)
    },

    /** Update drumkit param ref immediately without triggering a recompile. */
    setDrumKitParamFast: (instrumentId: Id, key: string, value: number) => {
      updateParamRef(`${instrumentId}:${key}`, value)
    },

    setDrumKitKeyRange: (instrumentId, keyLo, keyHi) =>
      get().mutate((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind !== 'drumkit') return
        inst.keyLo = Math.max(0, Math.min(127, keyLo))
        inst.keyHi = Math.max(0, Math.min(127, keyHi))
      }),

    setDrumKitParamSilent: (instrumentId, key, value) => {
      get().mutateSilent((draft) => {
        const inst = draft.entities.instruments[instrumentId]
        if (inst?.kind === 'drumkit' && key in inst.params) {
          ;(inst.params as Record<string, number>)[key] = value
        }
      })
      updateParamRef(`${instrumentId}:${key}`, value)
    },
  }
}
