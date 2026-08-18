import type { EffectLaneDef, Id } from '../domain/types'
import { makeId } from '../domain/factory'
import type { DocState } from './docStore'

export interface TrackerOps {
  setCellNote: (trackId: Id, row: number, note: number | null) => void
  /** @deprecated Use setCellHold instead. */
  setCellNoteOff: (trackId: Id, row: number, noteOff: boolean) => void
  setCellHold: (trackId: Id, row: number, hold: boolean) => void
  setCellVolume: (trackId: Id, row: number, volume: number | null) => void
  addEffectLane: (trackId: Id, type: string) => void
  removeEffectLane: (trackId: Id, laneId: Id) => void
  setEffectLaneType: (trackId: Id, laneId: Id, newType: string) => void
  setCellEffectLane: (trackId: Id, row: number, laneId: Id, value: number | null) => void
}

export function trackerOps(get: () => DocState): TrackerOps {
  return {
    setCellNote: (trackId, row, note) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (track && track.cells[row]) {
          track.cells[row].note = note
          // Note and hold/note-off are mutually exclusive.
          track.cells[row].noteOff = false
          track.cells[row].hold = false
        }
      }),

    /** @deprecated Use setCellHold instead. Kept for old song compat. */
    setCellNoteOff: (trackId, row, noteOff) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (track && track.cells[row]) {
          track.cells[row].noteOff = noteOff
          if (noteOff) track.cells[row].note = null
        }
      }),

    setCellHold: (trackId, row, hold) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (track && track.cells[row]) {
          track.cells[row].hold = hold
          // Hold and note are mutually exclusive: hold clears any note.
          if (hold) track.cells[row].note = null
        }
      }),

    setCellVolume: (trackId, row, volume) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (track && track.cells[row]) track.cells[row].volume = volume
      }),

    setCellEffectLane: (trackId, row, laneId, value) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (track && track.cells[row]) track.cells[row].effectLanes[laneId] = value
      }),

    addEffectLane: (trackId, type) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (!track) return
        const id = makeId('lan')
        const lane: EffectLaneDef = { id, type }
        track.effectLanes.push(lane)
        for (const cell of track.cells) {
          cell.effectLanes[id] = null
        }
      }),

    removeEffectLane: (trackId, laneId) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (!track) return
        track.effectLanes = track.effectLanes.filter((l) => l.id !== laneId)
        for (const cell of track.cells) {
          delete cell.effectLanes[laneId]
        }
      }),

    setEffectLaneType: (trackId, laneId, newType) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (!track) return
        const lane = track.effectLanes.find((l) => l.id === laneId)
        if (lane) lane.type = newType
      }),
  }
}
