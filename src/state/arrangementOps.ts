import type { Id, Pattern } from '../domain/types'
import { emptyCells, fitCells, makeId, newSection } from '../domain/factory'
import { clamp } from './helpers'
import type { DocState } from './docStore'

export interface ArrangementOps {
  setPatternLength: (patternId: Id, length: number) => void
  renamePattern: (patternId: Id, name: string) => void
  addPattern: (name?: string, length?: number) => Id
  removePattern: (patternId: Id) => void
  duplicatePattern: (patternId: Id) => Id
  setCurrentPattern: (patternId: Id) => void

  addSection: (name?: string) => Id
  removeSection: (sectionId: Id) => void
  renameSection: (sectionId: Id, name: string) => void
  addPatternToSection: (sectionId: Id, patternId: Id, atIndex?: number) => void
  removePatternFromSection: (sectionId: Id, patternIndex: number) => void
  reorderSections: (fromIdx: number, toIdx: number) => void
  reorderPatternsInSection: (sectionId: Id, fromIdx: number, toIdx: number) => void
}

export function arrangementOps(get: () => DocState): ArrangementOps {
  return {
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
  }
}
