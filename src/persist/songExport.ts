/**
 * Self-contained song export/import as a zip container (`.synthor`).
 *
 * The zip contains `song.json` + `samples/<hash>.bin` for every sample asset,
 * making the file fully portable across devices and storage origins. Standard zip
 * tools can open it; our app treats it as a single document.
 *
 * JSON-only export/import remains available for lightweight sharing.
 */

import { zipSync, strToU8 } from 'fflate'
import { serializeSong, type SongFile } from './serialize'
import { readSampleAsset, writeSampleData } from './sampleStorage'
import { unpackSongBundle } from './songBundle'
import type { SampleEntity } from '../domain/types'

/**
 * Build a self-contained `.synthor` zip blob.
 *
 * Reads the current song JSON and every referenced sample's binary data from
 * storage, then packs them into a single zip. Samples not found in storage are
 * silently skipped (the song will still load but those samples won't play).
 */
export async function exportSongZip(
  file: SongFile,
  slug: string,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}

  // song.json
  files['song.json'] = strToU8(serializeSong(file))

  // samples/<hash>.bin for each sample entity with data in storage
  const samples: SampleEntity[] = Object.values(file.doc.entities.samples)
  for (const s of samples) {
    const raw = await readSampleAsset(slug, s.hash)
    if (raw) {
      files[`samples/${s.hash}.bin`] = new Uint8Array(raw)
    }
  }

  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

/** Result of importing a `.synthor` or `.json` song file. */
export interface ImportResult {
  file: SongFile
  /** Where the samples were written, as chosen by `chooseSlug`. */
  slug: string
  /** Number of sample binaries extracted from the zip into storage. */
  samplesImported: number
}

/**
 * Import a `.synthor` zip (or plain JSON) file.
 *
 * If the data starts with `{` it's treated as plain JSON (backward compat).
 * Otherwise it's unzipped: `song.json` is parsed and every `samples/<hash>.bin`
 * entry is written to storage under the slug `chooseSlug` picks for the parsed song.
 */
export async function importSongZip(
  data: ArrayBuffer,
  chooseSlug: (file: SongFile) => string,
): Promise<ImportResult> {
  const { file, samples } = unpackSongBundle(data)
  const slug = chooseSlug(file)

  // Write sample binaries to storage
  for (const [hash, bytes] of samples) {
    await writeSampleData(slug, hash, bytes)
  }

  return { file, slug, samplesImported: samples.size }
}
