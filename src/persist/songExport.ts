/**
 * Self-contained song export/import as a zip container (`.synthor`).
 *
 * The zip contains `song.json` + `samples/<hash>.bin` for every sample asset,
 * making the file fully portable across devices and OPFS origins. Standard zip
 * tools can open it; our app treats it as a single document.
 *
 * JSON-only export/import remains available for lightweight sharing.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { deserializeSong, serializeSong, type SongFile } from './serialize'
import { readSampleAsset, writeSampleData } from './sampleStorage'
import type { SampleEntity } from '../domain/types'

/**
 * Build a self-contained `.synthor` zip blob.
 *
 * Reads the current song JSON and every referenced sample's binary data from
 * OPFS, then packs them into a single zip. Samples not found in OPFS are
 * silently skipped (the song will still load but those samples won't play).
 */
export async function exportSongZip(
  file: SongFile,
  slug: string,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}

  // song.json
  files['song.json'] = strToU8(serializeSong(file))

  // samples/<hash>.bin for each sample entity with data in OPFS
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
  /** Number of sample binaries extracted from the zip into OPFS. */
  samplesImported: number
}

/**
 * Import a `.synthor` zip (or plain JSON) file.
 *
 * If the data starts with `{` it's treated as plain JSON (backward compat).
 * Otherwise it's unzipped: `song.json` is parsed and every `samples/<hash>.bin`
 * entry is written to OPFS.
 */
export async function importSongZip(
  data: ArrayBuffer,
  slug: string,
): Promise<ImportResult> {
  // Detect format: JSON starts with '{', zip starts with 'PK' (0x50 0x4B).
  const view = new Uint8Array(data)
  const isJson = view[0] === 0x7B // '{'

  if (isJson) {
    const text = new TextDecoder().decode(data)
    return { file: deserializeSong(text), samplesImported: 0 }
  }

  // Unzip
  const entries = unzipSync(new Uint8Array(data))
  const songEntry = entries['song.json']
  if (!songEntry) throw new Error('Not a valid song file: missing song.json in zip')

  const text = strFromU8(songEntry)
  const file = deserializeSong(text)
  let samplesImported = 0

  // Write sample binaries to OPFS
  for (const [path, bytes] of Object.entries(entries)) {
    const match = /^samples\/([0-9a-f]+)\.bin$/.exec(path)
    if (!match) continue
    const hash = match[1]
    await writeSampleData(slug, hash, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    samplesImported++
  }

  return { file, samplesImported }
}
