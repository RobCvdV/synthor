import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import type { Doc, Id, ModuleType } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { clearParamRefs, updateParamRef } from '../audio/paramRefs'
import { createChannelEffect, createDefaultDoc, createMixChannel } from '../domain/factory'
import { isStereoEffect } from '../domain/moduleDefs'
import type { HistoryEntry, RectClipboard, TrackSnapshot } from './docStoreTypes'
import { trackerOps, type TrackerOps } from './trackerOps'
import { trackOps, type TrackOps } from './trackOps'
import { instrumentOps, type InstrumentOps } from './instrumentOps'
import { modularOps, type ModularOps } from './modularOps'
import { sampleOps, type SampleOps } from './sampleOps'
import { drumkitOps, type DrumkitOps } from './drumkitOps'
import { arrangementOps, type ArrangementOps } from './arrangementOps'

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

export interface DocState extends CoreOps, TrackerOps, TrackOps, InstrumentOps, ModularOps, SampleOps, DrumkitOps, ArrangementOps {
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
  ...sampleOps(get),
  ...drumkitOps(get),
  ...arrangementOps(get),

  // --- Sample management ---

  setVfsLoaded: (hashes) => set({ vfsLoadedHashes: hashes }),

  // --- Drum kit operations ---

  // --- Pattern operations ---

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

