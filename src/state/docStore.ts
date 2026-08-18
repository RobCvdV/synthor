import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import type { Doc, DrumKitSlot, Id, ModuleType, Pattern, SampleEntity } from '../domain/types'
import { getSlotForNote, MASTER_CHANNEL_ID } from '../domain/types'
import { clearParamRefs, updateParamRef } from '../audio/paramRefs'
import {
  createChannelEffect,
  createDefaultDoc,
  createMixChannel,
  emptyCells,
  fitCells,
  makeId,
  newSection,
} from '../domain/factory'
import { isStereoEffect } from '../domain/moduleDefs'
import type { HistoryEntry, RectClipboard, TrackSnapshot } from './docStoreTypes'
import { clamp } from './helpers'
import { trackerOps, type TrackerOps } from './trackerOps'
import { trackOps, type TrackOps } from './trackOps'
import { instrumentOps, type InstrumentOps } from './instrumentOps'
import { modularOps, type ModularOps } from './modularOps'

enablePatches()

interface CoreOps {
  /** Bump to trigger a render via store subscription. */
  bumpCompile: () => void
  /** Like mutate, but sets silentBatch so subscribers can skip the compile.
   *  Use for slider release — persist to store + undo without recompile. */
  mutateSilent: (recipe: (draft: Doc) => void) => void
  /** Store which sample hashes loaded into VFS after a sync. */
  setVfsLoaded: (hashes: Set<string>) => void
  /** Run an Immer recipe against the doc, recording it as one undoable edit. */
  mutate: (recipe: (draft: Doc) => void) => void
  undo: () => void
  redo: () => void
  /** Replace the whole document (e.g. loading a saved song). Resets history. */
  loadDoc: (doc: Doc) => void
}

export interface DocState extends CoreOps, TrackerOps, TrackOps, InstrumentOps, ModularOps {
  doc: Doc
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Non-undoable scratch space for track copy/paste. */
  trackClipboard: TrackSnapshot | null
  /** Non-undoable scratch space for rectangular cell copy/paste. */
  rectClipboard: RectClipboard | null
  /** Counter bumped to force a render (e.g. after host.start() mounts refs). */
  compileTick: number
  /** When true, docStore subscribers skip their side effects — used by
   *  mutateSilent to persist values without triggering graph recompiles. */
  silentBatch: boolean
  /** Hashes of samples that loaded successfully into VFS. null = not yet synced. */
  vfsLoadedHashes: Set<string> | null

  // --- Pattern operations ---
  setPatternLength: (patternId: Id, length: number) => void
  renamePattern: (patternId: Id, name: string) => void
  addPattern: (name?: string, length?: number) => Id
  removePattern: (patternId: Id) => void
  duplicatePattern: (patternId: Id) => Id
  setCurrentPattern: (patternId: Id) => void

  // --- Section operations ---
  addSection: (name?: string) => Id
  removeSection: (sectionId: Id) => void
  renameSection: (sectionId: Id, name: string) => void
  addPatternToSection: (sectionId: Id, patternId: Id, atIndex?: number) => void
  removePatternFromSection: (sectionId: Id, patternIndex: number) => void
  reorderSections: (fromIdx: number, toIdx: number) => void
  reorderPatternsInSection: (sectionId: Id, fromIdx: number, toIdx: number) => void

  // --- Sample management ---
  addSampleEntity: (entity: SampleEntity) => void
  removeSampleEntity: (id: Id) => void
  replaceSampleAsset: (id: Id, hash: string, originalName: string, sampleRate: number, channels: number, frames: number) => void
  renameSample: (id: Id, name: string) => void

  // --- Drum kit operations ---
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

  // --- Mixer actions ---
  addChannel: (kind: 'sub') => Id
  removeChannel: (channelId: Id) => void
  renameChannel: (channelId: Id, name: string) => void
  setChannelVolume: (channelId: Id, vol: number) => void
  setChannelVolumeFast: (channelId: Id, vol: number) => void
  setChannelPan: (channelId: Id, pan: number) => void
  setChannelMute: (channelId: Id, mute: boolean) => void
  setChannelSolo: (channelId: Id, solo: boolean) => void
  addChannelEffect: (channelId: Id, type: ModuleType) => Id
  removeChannelEffect: (channelId: Id, effectId: Id) => void
  moveChannelEffect: (channelId: Id, effectId: Id, newIndex: number) => void
  setChannelEffectParam: (channelId: Id, effectId: Id, key: string, value: number) => void
  setChannelEffectParamFast: (channelId: Id, effectId: Id, key: string, value: number) => void
  hideInstrumentFromMixer: (instrumentId: Id) => void
  showInstrumentInMixer: (instrumentId: Id) => void
  reorderMixerInstrument: (instrumentId: Id, newIndex: number) => void
  setInstrumentChannelId: (instrumentId: Id, channelId: Id) => void
  setInstrumentPan: (instrumentId: Id, pan: number) => void
  setInstrumentPanFast: (instrumentId: Id, pan: number) => void
  setInstrumentPanSilent: (instrumentId: Id, pan: number) => void
  setDrumKitParamSilent: (instrumentId: Id, key: string, value: number) => void
  setChannelVolumeSilent: (channelId: Id, vol: number) => void
  setChannelPanSilent: (channelId: Id, pan: number) => void
  setChannelEffectParamSilent: (channelId: Id, effectId: Id, key: string, value: number) => void
}

const HISTORY_LIMIT = 200

export const useDocStore = create<DocState>((set, get) => ({
  doc: createDefaultDoc(),
  past: [],
  future: [],
  trackClipboard: null,
  rectClipboard: null,
  vfsLoadedHashes: null,
  compileTick: 0,
  silentBatch: false,

  bumpCompile: () => set((s) => ({ compileTick: s.compileTick + 1 })),

  mutateSilent: (recipe) => {
    set({ silentBatch: true })
    get().mutate(recipe)
    set({ silentBatch: false })
  },

  mutate: (recipe) => {
    const { doc, past } = get()
    const [next, patches, inverse] = produceWithPatches(doc, recipe)
    if (patches.length === 0) return // no-op edit, don't pollute history
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(1) : past
    set({ doc: next, past: [...trimmed, { patches, inverse }], future: [] })
  },

  loadDoc: (doc) =>
    set({ doc, past: [], future: [], trackClipboard: null, rectClipboard: null, vfsLoadedHashes: null }),

  undo: () => {
    const { doc, past, future } = get()
    const entry = past[past.length - 1]
    if (!entry) return
    set({ doc: applyPatches(doc, entry.inverse), past: past.slice(0, -1), future: [entry, ...future] })
    clearParamRefs() // refs hold stale values after undo
  },

  redo: () => {
    const { doc, past, future } = get()
    const entry = future[0]
    if (!entry) return
    set({ doc: applyPatches(doc, entry.patches), past: [...past, entry], future: future.slice(1) })
    clearParamRefs() // refs hold stale values after redo
  },

  ...trackerOps(get),
  ...trackOps(set, get),
  ...instrumentOps(get),
  ...modularOps(get),

  // --- Sample management ---

  addSampleEntity: (entity) =>
    get().mutate((draft) => {
      draft.entities.samples[entity.id] = entity
    }),

  removeSampleEntity: (id) =>
    get().mutate((draft) => {
      const sample = draft.entities.samples[id]
      if (!sample) return
      // Guard: don't delete if any drumkit slot references this sample.
      for (const inst of Object.values(draft.entities.instruments)) {
        if (inst.kind === 'drumkit') {
          for (const slot of inst.slots) {
            if (slot.sampleId === id) return
          }
        }
      }
      delete draft.entities.samples[id]
    }),

  renameSample: (id, name) =>
    get().mutate((draft) => {
      const sample = draft.entities.samples[id]
      if (!sample) return
      sample.name = name.trim()
    }),

  replaceSampleAsset: (id, hash, originalName, sampleRate, channels, frames) =>
    get().mutate((draft) => {
      const sample = draft.entities.samples[id]
      if (!sample) return
      sample.hash = hash
      sample.originalName = originalName
      sample.sampleRate = sampleRate
      sample.channels = channels
      sample.frames = frames
    }),

  setVfsLoaded: (hashes) => set({ vfsLoadedHashes: hashes }),

  // --- Drum kit operations ---

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

  // --- Pattern operations ---

  setPatternLength: (patternId, length) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[patternId]
      if (!pattern || length < 1 || length > 256) return
      pattern.length = length
      for (const trackId of pattern.trackIds) {
        const track = draft.entities.tracks[trackId]
        if (track) track.cells = fitCells(track.cells, length)
      }
    }),

  renamePattern: (patternId, name) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[patternId]
      if (pattern) pattern.name = name
    }),

  addPattern: (name, length) => {
    const src = get().doc.entities.patterns[get().doc.patternId]
    const patName = name ?? `Pattern ${String(Object.keys(get().doc.entities.patterns).length + 1).padStart(2, '0')}`
    const patternId = makeId('pat')
    get().mutate((draft) => {
      // Nothing to base on → a bare 32-row pattern.
      if (!src) {
        draft.entities.patterns[patternId] = { id: patternId, name: patName, length: length ?? 32, trackIds: [] }
      } else {
        // A pattern is selected → same structure and length, all lanes cleared.
        const newTrackIds: Id[] = []
        for (const tid of src.trackIds) {
          const srcTrack = draft.entities.tracks[tid]
          if (!srcTrack) continue
          const newTrackId = makeId('trk')
          draft.entities.tracks[newTrackId] = {
            id: newTrackId,
            instrumentId: srcTrack.instrumentId,
            cells: emptyCells(src.length),
            effectLanes: [...srcTrack.effectLanes],
          }
          newTrackIds.push(newTrackId)
        }
        draft.entities.patterns[patternId] = { id: patternId, name: patName, length: src.length, trackIds: newTrackIds }
      }
      // The new pattern becomes the current one immediately.
      draft.patternId = patternId
    })
    return patternId
  },

  removePattern: (patternId) =>
    get().mutate((draft) => {
      const pattern = draft.entities.patterns[patternId]
      if (!pattern) return
      // Don't delete the last pattern.
      if (Object.keys(draft.entities.patterns).length <= 1) return
      // Delete tracks owned by this pattern.
      for (const trackId of pattern.trackIds) {
        delete draft.entities.tracks[trackId]
      }
      delete draft.entities.patterns[patternId]
      // Remove from all sections that reference it.
      for (const section of Object.values(draft.entities.sections)) {
        section.patternIds = section.patternIds.filter((id) => id !== patternId)
      }
      // If the deleted pattern was current, switch to the first available.
      if (draft.patternId === patternId) {
        draft.patternId = Object.keys(draft.entities.patterns)[0]
      }
    }),

  duplicatePattern: (patternId) => {
    const doc = get().doc
    const src = doc.entities.patterns[patternId]
    if (!src) return ''
    const newId = makeId('pat')
    get().mutate((draft) => {
      // Clone tracks with fresh ids, preserving cells and instrument refs.
      const newTrackIds: Id[] = []
      for (const tid of src.trackIds) {
        const srcTrack = draft.entities.tracks[tid]
        if (!srcTrack) continue
        const newTrackId = makeId('trk')
        draft.entities.tracks[newTrackId] = {
          id: newTrackId,
          instrumentId: srcTrack.instrumentId,
          cells: srcTrack.cells.map((c) => ({ note: c.note, volume: c.volume, noteOff: c.noteOff, hold: c.hold ?? false, effectLanes: { ...c.effectLanes } })),
          effectLanes: [...srcTrack.effectLanes],
        }
        newTrackIds.push(newTrackId)
      }
      const newPattern: Pattern = {
        id: newId,
        name: `${src.name} (copy)`,
        length: src.length,
        trackIds: newTrackIds,
      }
      draft.entities.patterns[newId] = newPattern
    })
    return newId
  },

  setCurrentPattern: (patternId) =>
    get().mutate((draft) => {
      if (draft.entities.patterns[patternId]) draft.patternId = patternId
    }),

  // --- Section operations ---

  addSection: (name) => {
    const sec = newSection(name ?? `Section ${Object.keys(get().doc.entities.sections).length + 1}`)
    get().mutate((draft) => {
      draft.entities.sections[sec.id] = sec
      draft.sectionIds.push(sec.id)
    })
    return sec.id
  },

  removeSection: (sectionId) =>
    get().mutate((draft) => {
      const idx = draft.sectionIds.indexOf(sectionId)
      if (idx < 0) return
      // Don't delete the last section.
      if (draft.sectionIds.length <= 1) return
      draft.sectionIds.splice(idx, 1)
      delete draft.entities.sections[sectionId]
    }),

  renameSection: (sectionId, name) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (section) section.name = name
    }),

  addPatternToSection: (sectionId, patternId, atIndex) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (!section || !draft.entities.patterns[patternId]) return
      const idx = atIndex ?? section.patternIds.length
      section.patternIds.splice(clamp(idx, 0, section.patternIds.length), 0, patternId)
    }),

  removePatternFromSection: (sectionId, patternIndex) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (!section || patternIndex < 0 || patternIndex >= section.patternIds.length) return
      section.patternIds.splice(patternIndex, 1)
    }),

  reorderSections: (fromIdx, toIdx) =>
    get().mutate((draft) => {
      const ids = draft.sectionIds
      if (fromIdx < 0 || fromIdx >= ids.length || toIdx < 0 || toIdx >= ids.length || fromIdx === toIdx) return
      const [id] = ids.splice(fromIdx, 1)
      ids.splice(toIdx, 0, id)
    }),

  reorderPatternsInSection: (sectionId, fromIdx, toIdx) =>
    get().mutate((draft) => {
      const section = draft.entities.sections[sectionId]
      if (!section) return
      const ids = section.patternIds
      if (fromIdx < 0 || fromIdx >= ids.length || toIdx < 0 || toIdx >= ids.length || fromIdx === toIdx) return
      const [id] = ids.splice(fromIdx, 1)
      ids.splice(toIdx, 0, id)
    }),

  // ── Mixer actions ──────────────────────────────────────────────

  addChannel: (_kind) => {
    const chan = createMixChannel(`Sub ${Object.keys(get().doc.entities.mixChannels).filter((id) => id !== MASTER_CHANNEL_ID).length + 1}`)
    get().mutate((draft) => { draft.entities.mixChannels[chan.id] = chan })
    return chan.id
  },

  removeChannel: (channelId) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan || chan.kind === 'master') return
      delete draft.entities.mixChannels[channelId]
      // Re-route instruments that pointed to this channel back to master.
      for (const inst of Object.values(draft.entities.instruments)) {
        if (inst.channelId === channelId) inst.channelId = MASTER_CHANNEL_ID
      }
    }),

  renameChannel: (channelId, name) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.name = name
    }),

  setChannelVolume: (channelId, vol) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.volume = vol
    }),

  setChannelVolumeFast: (channelId, vol) => {
    updateParamRef(`chan:${channelId}:volume`, vol)
  },

  setChannelPan: (channelId, pan) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.pan = pan
    }),

  setChannelMute: (channelId, mute) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.mute = mute
    }),

  setChannelSolo: (channelId, solo) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.solo = solo
    }),

  addChannelEffect: (channelId, type) => {
    if (isStereoEffect(type)) {
      const effect = createChannelEffect(type)
      get().mutate((draft) => {
        const chan = draft.entities.mixChannels[channelId]
        if (chan) chan.effects.push(effect)
      })
      return effect.id
    }
    // Mono effects → create L + R instances.
    const efL = createChannelEffect(type, 'L')
    const efR = createChannelEffect(type, 'R')
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) { chan.effects.push(efL); chan.effects.push(efR) }
    })
    return efL.id
  },

  removeChannelEffect: (channelId, effectId) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const idx = chan.effects.findIndex((e) => e.id === effectId)
      if (idx >= 0) chan.effects.splice(idx, 1)
    }),

  moveChannelEffect: (channelId, effectId, newIndex) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const idx = chan.effects.findIndex((e) => e.id === effectId)
      if (idx < 0) return
      const [item] = chan.effects.splice(idx, 1)
      chan.effects.splice(newIndex, 0, item)
    }),

  setChannelEffectParam: (channelId, effectId, key, value) =>
    get().mutate((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const fx = chan.effects.find((e) => e.id === effectId)
      if (fx) fx.params[key] = value
    }),

  setChannelEffectParamFast: (channelId, effectId, key, value) => {
    updateParamRef(`chan:${channelId}:${effectId}:${key}`, value)
  },

  hideInstrumentFromMixer: (instrumentId) =>
    get().mutate((draft) => {
      const order = draft.entities.mixerInstrumentOrder
      const idx = order.indexOf(instrumentId)
      if (idx >= 0) order.splice(idx, 1)
    }),

  showInstrumentInMixer: (instrumentId) =>
    get().mutate((draft) => {
      const order = draft.entities.mixerInstrumentOrder
      if (!order.includes(instrumentId)) order.push(instrumentId)
    }),

  reorderMixerInstrument: (instrumentId, newIndex) =>
    get().mutate((draft) => {
      const order = draft.entities.mixerInstrumentOrder
      const idx = order.indexOf(instrumentId)
      if (idx < 0) return
      const [id] = order.splice(idx, 1)
      order.splice(newIndex, 0, id)
    }),

  setInstrumentChannelId: (instrumentId, channelId) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst && draft.entities.mixChannels[channelId]) inst.channelId = channelId
    }),

  setInstrumentPan: (instrumentId, pan) =>
    get().mutate((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.pan = pan
    }),

  setInstrumentPanFast: (instrumentId, pan) => {
    updateParamRef(`inst:${instrumentId}:pan`, pan)
  },

  setInstrumentPanSilent: (instrumentId, pan) => {
    get().mutateSilent((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst) inst.pan = pan
    })
    updateParamRef(`inst:${instrumentId}:pan`, pan)
  },

  setDrumKitParamSilent: (instrumentId, key, value) => {
    get().mutateSilent((draft) => {
      const inst = draft.entities.instruments[instrumentId]
      if (inst?.kind === 'drumkit' && key in inst.params) {
        ;(inst.params as Record<string, number>)[key] = value
      }
    })
    updateParamRef(`${instrumentId}:${key}`, value)
  },

  setChannelVolumeSilent: (channelId, vol) => {
    get().mutateSilent((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.volume = vol
    })
    updateParamRef(`chan:${channelId}:volume`, vol)
  },

  setChannelPanSilent: (channelId, pan) => {
    get().mutateSilent((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (chan) chan.pan = pan
    })
    updateParamRef(`chan:${channelId}:pan`, pan)
  },

  setChannelEffectParamSilent: (channelId, effectId, key, value) => {
    get().mutateSilent((draft) => {
      const chan = draft.entities.mixChannels[channelId]
      if (!chan) return
      const fx = chan.effects.find((e) => e.id === effectId)
      if (fx) fx.params[key] = value
    })
    updateParamRef(`chan:${channelId}:${effectId}:${key}`, value)
  },

}))

