import type { EffectLaneDef, Id } from '../domain/types'
import { makeId } from '../domain/factory'
import { interpolateValues } from '../domain/effects'
import type { DocState } from './docStore'

export interface TrackerOps {
  setCellNote: (trackId: Id, row: number, note: number | null) => void
  setCellHold: (trackId: Id, row: number, hold: boolean) => void
  setCellVolume: (trackId: Id, row: number, volume: number | null) => void
  addEffectLane: (trackId: Id, type: string) => void
  removeEffectLane: (trackId: Id, laneId: Id) => void
  setEffectLaneType: (trackId: Id, laneId: Id, newType: string) => void
  setCellEffectLane: (trackId: Id, row: number, laneId: Id, value: number | null) => void
  /** Shifts every note in rows r0..r1 of the tracks by `semitones` (clamped to MIDI 0..127), as one undo step. */
  transposeRows: (trackIds: Id[], r0: number, r1: number, semitones: number) => void
  /** Linear fill of rows r0..r1 in one column as one undo step; `laneId` null is the volume column. */
  interpolateColumn: (trackId: Id, r0: number, r1: number, laneId: Id | null, from: number, to: number) => void
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

    transposeRows: (trackIds, r0, r1, semitones) =>
      get().mutate((draft) => {
        for (const tid of trackIds) {
          const cells = draft.entities.tracks[tid]?.cells ?? []
          for (let r = Math.max(0, r0); r <= r1 && r < cells.length; r++) {
            const note = cells[r].note
            if (note !== null) cells[r].note = Math.max(0, Math.min(127, note + semitones))
          }
        }
      }),

    interpolateColumn: (trackId, r0, r1, laneId, from, to) =>
      get().mutate((draft) => {
        const track = draft.entities.tracks[trackId]
        if (!track || (laneId !== null && !track.effectLanes.some((l) => l.id === laneId))) return
        interpolateValues(from, to, r1 - r0 + 1).forEach((v, i) => {
          const cell = track.cells[r0 + i]
          if (!cell) return
          if (laneId === null) cell.volume = v
          else cell.effectLanes[laneId] = v
        })
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
