import { referencedSampleIds } from '../domain/instrumentBundle'
import type { Doc, Id } from '../domain/types'

/** A sample's audio swapped for a tuned version already uploaded to the VFS under `key`. */
export interface AuditionOverride {
  sampleId: Id
  key: string
  frames: number
  channels: number
}

export function auditionKey(sampleId: Id, version: number): string {
  return `audition:${sampleId}:${version}`
}

/** The doc the engine compiles: the auditioned sample points at its tuned audio. */
export function withAudition(doc: Doc, o: AuditionOverride | null): Doc {
  const sample = o && doc.entities.samples[o.sampleId]
  if (!o || !sample) return doc
  return {
    ...doc,
    entities: {
      ...doc.entities,
      samples: { ...doc.entities.samples, [o.sampleId]: { ...sample, hash: o.key, frames: o.frames, channels: o.channels } },
    },
  }
}

/** Whether anything the engine compiles plays the sample; auditioning an unused one needs no recompile. */
export function sampleInUse(doc: Doc, sampleId: Id): boolean {
  const { instruments, mixChannels } = doc.entities
  return Object.values(instruments).some((inst) => referencedSampleIds(inst).includes(sampleId)) ||
    Object.values(mixChannels).some((c) => c.effects.some((e) => e.sampleId === sampleId))
}
