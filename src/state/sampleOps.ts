import type { Id, LibraryInfo, SampleEntity } from '../domain/types'
import { patchLibraryInfo } from '../domain/library'
import type { DocState } from './docStore'

export interface SampleOps {
  addSampleEntity: (entity: SampleEntity) => void
  removeSampleEntity: (id: Id) => void
  replaceSampleAsset: (id: Id, hash: string, originalName: string, sampleRate: number, channels: number, frames: number) => void
  renameSample: (id: Id, name: string) => void
  /** Updates the library attributes the sample keeps in the song (category, tags, library link). */
  setSampleLibraryInfo: (id: Id, patch: Partial<LibraryInfo>) => void
}

export function sampleOps(get: () => DocState): SampleOps {
  return {
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

    setSampleLibraryInfo: (id, patch) =>
      get().mutate((draft) => {
        const sample = draft.entities.samples[id]
        if (sample) sample.library = patchLibraryInfo(sample.library, patch)
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
  }
}
