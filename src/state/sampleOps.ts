import type { Id, SampleEntity } from '../domain/types'
import type { DocState } from './docStore'

export interface SampleOps {
  addSampleEntity: (entity: SampleEntity) => void
  removeSampleEntity: (id: Id) => void
  replaceSampleAsset: (id: Id, hash: string, originalName: string, sampleRate: number, channels: number, frames: number) => void
  renameSample: (id: Id, name: string) => void
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
