/** Sample binary assets, stored per song as `songs/<slug>/samples/<hash>.bin`. */
import { songDir } from './songStore'
import { joinPath, requireStorage } from './storage'

function samplesDir(slug: string): string {
  return joinPath(songDir(slug), 'samples')
}

function samplePath(slug: string, hash: string): string {
  return joinPath(samplesDir(slug), `${hash}.bin`)
}

/** Store the raw audio file bytes under its content hash. */
export async function writeSampleAsset(slug: string, hash: string, file: File): Promise<void> {
  await requireStorage().write(samplePath(slug, hash), await file.arrayBuffer())
}

/** Read stored sample bytes by hash. Returns null if not found. */
export async function readSampleAsset(slug: string, hash: string): Promise<ArrayBuffer | null> {
  return requireStorage().readBytes(samplePath(slug, hash))
}

/** Write raw sample bytes (e.g. from a zip import); skipped when the hash is already stored. */
export async function writeSampleData(slug: string, hash: string, data: ArrayBuffer): Promise<void> {
  const s = requireStorage()
  const path = samplePath(slug, hash)
  if (await s.exists(path)) return
  await s.write(path, data)
}

/** Delete a stored sample by hash. No-op if not found. */
export async function deleteSampleAsset(slug: string, hash: string): Promise<void> {
  await requireStorage().remove(samplePath(slug, hash))
}

/** List all sample hashes stored for a song. */
export async function listSampleAssets(slug: string): Promise<string[]> {
  const entries = await requireStorage().list(samplesDir(slug))
  return entries
    .filter((e) => e.kind === 'file' && e.name.endsWith('.bin'))
    .map((e) => e.name.replace(/\.bin$/, ''))
}
