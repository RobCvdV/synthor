/**
 * An instrument with everything it needs to play elsewhere: the drumkit
 * sub-instruments it uses and the samples they reference. The unit of
 * instrument export/import and of the instrument library.
 */
import { cloneInstrument, makeId } from './factory'
import { MASTER_CHANNEL_ID, type Entities, type Id, type Instrument, type LibraryInfo, type SampleEntity } from './types'

export interface InstrumentBundle {
  rootId: Id
  /** The root plus every instrument reachable through drumkit slots. */
  instruments: Record<Id, Instrument>
  samples: Record<Id, SampleEntity>
}

function referencedSampleIds(inst: Instrument): Id[] {
  if (inst.kind === 'drumkit') return inst.slots.flatMap((s) => (s.sampleId ? [s.sampleId] : []))
  return Object.values(inst.modules).flatMap((m) => (m.sampleId ? [m.sampleId] : []))
}

/** Gathers an instrument, its sub-instruments and their samples. Missing references are skipped. */
export function collectInstrumentBundle(entities: Pick<Entities, 'instruments' | 'samples'>, rootId: Id): InstrumentBundle {
  const instruments: Record<Id, Instrument> = {}
  const samples: Record<Id, SampleEntity> = {}
  const visit = (id: Id) => {
    const inst = entities.instruments[id]
    if (!inst || instruments[id]) return
    // Files and the library keep these as their own metadata.
    const { library: _, ...rest } = inst
    instruments[id] = rest as Instrument
    for (const sid of referencedSampleIds(inst)) {
      const smp = entities.samples[sid]
      if (!smp) continue
      const { library: _lib, ...plain } = smp
      samples[sid] = plain
    }
    if (inst.kind === 'drumkit') for (const slot of inst.slots) if (slot.instrumentId) visit(slot.instrumentId)
  }
  visit(rootId)
  if (!instruments[rootId]) throw new Error(`Unknown instrument: ${rootId}`)
  return { rootId, instruments, samples }
}

/**
 * Adds a copy of the bundle to `entities` (an Immer draft or a plain object) and returns the new
 * root id. Everything gets fresh ids; a sample whose content is already present is reused; only
 * the root joins the mixer, and routing to a channel this song lacks falls back to master.
 * `library` becomes the root's library attributes.
 */
export function insertInstrumentBundle(entities: Entities, bundle: InstrumentBundle, library?: LibraryInfo): Id {
  const sampleIds = new Map<Id, Id>()
  const byHash = new Map(Object.values(entities.samples).map((s) => [s.hash, s.id]))
  for (const smp of Object.values(bundle.samples)) {
    const existing = byHash.get(smp.hash)
    if (existing) {
      sampleIds.set(smp.id, existing)
      continue
    }
    const id = makeId('smp')
    entities.samples[id] = { ...smp, id }
    byHash.set(smp.hash, id)
    sampleIds.set(smp.id, id)
  }

  const clones = new Map<Id, Instrument>()
  for (const inst of Object.values(bundle.instruments)) clones.set(inst.id, cloneInstrument(inst, inst.name))

  const remapSample = (id: Id | null | undefined) => (id ? sampleIds.get(id) ?? null : null)
  for (const inst of clones.values()) {
    if (!entities.mixChannels[inst.channelId]) inst.channelId = MASTER_CHANNEL_ID
    if (inst.kind === 'drumkit') {
      for (const slot of inst.slots) {
        slot.sampleId = remapSample(slot.sampleId)
        slot.instrumentId = slot.instrumentId ? clones.get(slot.instrumentId)?.id ?? null : null
      }
    } else {
      for (const mod of Object.values(inst.modules)) {
        const sampleId = remapSample(mod.sampleId)
        if (sampleId) mod.sampleId = sampleId
        else delete mod.sampleId
      }
    }
    entities.instruments[inst.id] = inst
  }

  const root = clones.get(bundle.rootId)
  if (!root) throw new Error('Instrument bundle has no root instrument')
  if (library) root.library = { ...library, tags: [...library.tags] }
  entities.mixerInstrumentOrder.push(root.id)
  return root.id
}
