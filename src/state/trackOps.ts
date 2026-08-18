import type { StoreApi } from 'zustand'
import type { Cell, EffectLaneDef, Id } from '../domain/types'
import { cloneInstrument, fitCells, newTrack } from '../domain/factory'
import { clamp } from './helpers'
import type { DocState } from './docStore'

export interface TrackOps {
  addTrack: (atIndex: number, instrumentId: Id) => void
  removeTrack: (trackId: Id) => void
  moveTrack: (from: number, to: number) => void
  copyTrack: (trackId: Id) => void
  pasteTrack: (atIndex: number) => void
  duplicateTrack: (trackId: Id, atIndex: number) => void
  /** Rotate a track's cells one row up or down, wrapping around. */
  shiftTrack: (trackId: Id, dir: 'up' | 'down') => void

  copyRect: (trackIds: Id[], startRow: number, endRow: number, startTrack: number, endTrack: number) => void
  cutRect: (trackIds: Id[], startRow: number, endRow: number, startTrack: number, endTrack: number) => void
  pasteRect: (trackIds: Id[], atRow: number, atTrack: number) => void
}

export function trackOps(
  set: StoreApi<DocState>['setState'],
  get: () => DocState,
): TrackOps {
  return {
    addTrack: (atIndex, instrumentId) =>
      get().mutate((draft) => {
        const pattern = draft.entities.patterns[draft.patternId]
        // Use the given instrument (caller provides it, e.g. from the cursor
        // track) — no auto-creating instruments just to add a layer.
        if (!draft.entities.instruments[instrumentId]) return
        const track = newTrack(instrumentId, pattern.length)
        draft.entities.tracks[track.id] = track
        pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
      }),

    removeTrack: (trackId) =>
      get().mutate((draft) => {
        const pattern = draft.entities.patterns[draft.patternId]
        const idx = pattern.trackIds.indexOf(trackId)
        if (idx < 0) return
        pattern.trackIds.splice(idx, 1)
        delete draft.entities.tracks[trackId]
        // Instruments are first-class now: removing a track leaves its instrument
        // in place (it may be shared, and orphan instruments are fine to keep and
        // reassign from the instruments panel).
      }),

    moveTrack: (from, to) =>
      get().mutate((draft) => {
        const ids = draft.entities.patterns[draft.patternId].trackIds
        if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return
        const [id] = ids.splice(from, 1)
        ids.splice(to, 0, id)
      }),

    copyTrack: (trackId) => {
      const { doc } = get()
      const track = doc.entities.tracks[trackId]
      if (!track) return
      // Docs are immutable snapshots, so storing the instrument by reference is
      // safe; paste clones it with fresh ids.
      set({
        trackClipboard: {
          instrument: doc.entities.instruments[track.instrumentId],
          cells: track.cells.map((c) => ({ ...c })),
          effectLanes: [...track.effectLanes],
        },
      })
    },

    pasteTrack: (atIndex) => {
      const snap = get().trackClipboard
      if (!snap) return
      get().mutate((draft) => {
        const pattern = draft.entities.patterns[draft.patternId]
        const inst = cloneInstrument(snap.instrument, snap.instrument.name)
        const track = newTrack(inst.id, pattern.length)
        track.cells = fitCells(snap.cells, pattern.length)
        track.effectLanes = snap.effectLanes.map((l) => ({ ...l }))
        draft.entities.instruments[inst.id] = inst
        draft.entities.tracks[track.id] = track
        pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
      })
    },

    duplicateTrack: (trackId, atIndex) =>
      get().mutate((draft) => {
        const pattern = draft.entities.patterns[draft.patternId]
        const src = draft.entities.tracks[trackId]
        if (!src) return
        // Duplicating a track shares the same instrument (true reference reuse):
        // both lanes drive one instrument. Copy/paste is the "independent copy".
        const track = newTrack(src.instrumentId, pattern.length)
        track.cells = src.cells.map((c) => ({ note: c.note, volume: c.volume, noteOff: c.noteOff, hold: c.hold ?? false, effectLanes: { ...c.effectLanes } }))
        track.effectLanes = [...src.effectLanes]
        draft.entities.tracks[track.id] = track
        pattern.trackIds.splice(clamp(atIndex, 0, pattern.trackIds.length), 0, track.id)
      }),

    shiftTrack: (trackId, dir) =>
      get().mutate((draft) => {
        const cells = draft.entities.tracks[trackId]?.cells
        if (!cells || cells.length < 2) return
        if (dir === 'up') cells.push(cells.shift()!) // row 0 wraps to the bottom
        else cells.unshift(cells.pop()!) // last row wraps to the top
      }),

    // --- Rectangular clipboard ---

    copyRect: (trackIds, startRow, endRow, startTrack, endTrack) => {
      const { doc } = get()
      const t0 = Math.max(0, Math.min(startTrack, endTrack))
      const t1 = Math.min(trackIds.length - 1, Math.max(startTrack, endTrack))
      const r0 = Math.max(0, Math.min(startRow, endRow))
      const r1 = Math.min(doc.entities.patterns[doc.patternId].length - 1, Math.max(startRow, endRow))
      const cells: Cell[][] = []
      const trackLanes: EffectLaneDef[][] = []
      for (let ti = t0; ti <= t1; ti++) {
        const track = doc.entities.tracks[trackIds[ti]]
        const col: Cell[] = []
        for (let r = r0; r <= r1; r++) {
          const c = track?.cells[r]
          col.push(c ? { note: c.note, volume: c.volume, noteOff: c.noteOff, hold: c.hold ?? false, effectLanes: { ...c.effectLanes } } : { note: null, volume: null, noteOff: false, hold: false, effectLanes: {} })
        }
        cells.push(col)
        trackLanes.push(track ? [...track.effectLanes] : [])
      }
      set({ rectClipboard: { cells, trackLanes } })
    },

    cutRect: (trackIds, startRow, endRow, startTrack, endTrack) => {
      get().copyRect(trackIds, startRow, endRow, startTrack, endTrack)
      get().mutate((draft) => {
        const pattern = draft.entities.patterns[draft.patternId]
        const t0 = Math.max(0, Math.min(startTrack, endTrack))
        const t1 = Math.min(trackIds.length - 1, Math.max(startTrack, endTrack))
        const r0 = Math.max(0, Math.min(startRow, endRow))
        const r1 = Math.min(pattern.length - 1, Math.max(startRow, endRow))
        for (let ti = t0; ti <= t1; ti++) {
          const track = draft.entities.tracks[trackIds[ti]]
          if (!track) continue
          for (let r = r0; r <= r1; r++) {
            if (track.cells[r]) {
              track.cells[r] = { note: null, volume: null, noteOff: false, hold: false, effectLanes: {} }
            }
          }
        }
      })
    },

    pasteRect: (trackIds, atRow, atTrack) => {
      const clip = get().rectClipboard
      if (!clip || clip.cells.length === 0) return
      get().mutate((draft) => {
        const pattern = draft.entities.patterns[draft.patternId]
        for (let ti = 0; ti < clip.cells.length; ti++) {
          const targetIdx = atTrack + ti
          if (targetIdx < 0 || targetIdx >= trackIds.length) continue
          const track = draft.entities.tracks[trackIds[targetIdx]]
          if (!track) continue
          const col = clip.cells[ti]

          // Auto-create any effect lanes referenced by the pasted cells
          // that don't exist on the target track yet.
          const srcLanes = clip.trackLanes[ti] ?? []
          for (const srcLane of srcLanes) {
            if (!track.effectLanes.some((l) => l.id === srcLane.id)) {
              track.effectLanes.push({ ...srcLane })
            }
          }

          for (let ri = 0; ri < col.length; ri++) {
            const targetRow = atRow + ri
            if (targetRow < 0 || targetRow >= pattern.length) continue
            track.cells[targetRow] = { ...col[ri] }
          }
        }
      })
    },
  }
}
