import { collectInstrumentBundle, insertInstrumentBundle } from '../domain/instrumentBundle'
import type { Id } from '../domain/types'
import { INSTRUMENT_FILE_EXT, packInstrumentFile, unpackInstrumentFile } from '../persist/instrumentFile'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { hasStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'

/** A `.synthinst` file of the instrument with its sub-instruments and sample data. */
export async function exportInstrumentFile(instrumentId: Id): Promise<{ blob: Blob; filename: string }> {
  const { entities } = useDocStore.getState().doc
  const bundle = collectInstrumentBundle(entities, instrumentId)
  const { slug } = useProjectStore.getState()
  const zip = await packInstrumentFile(bundle, (hash) => (hasStorage() ? readSampleAsset(slug, hash) : Promise.resolve(null)))
  const name = entities.instruments[instrumentId].name || 'instrument'
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), filename: `${name}${INSTRUMENT_FILE_EXT}` }
}

/** Adds an instrument file to the open song (sample data first, so it loads right away); returns the new instrument id. */
export async function importInstrumentFile(data: ArrayBuffer): Promise<Id> {
  const { bundle, sampleData } = unpackInstrumentFile(data)
  if (hasStorage()) {
    const { slug } = useProjectStore.getState()
    for (const [hash, bytes] of Object.entries(sampleData)) {
      await writeSampleData(slug, hash, bytes.slice().buffer as ArrayBuffer)
    }
  }
  let rootId: Id = ''
  useDocStore.getState().mutate((draft) => {
    rootId = insertInstrumentBundle(draft.entities, bundle)
  })
  return rootId
}
