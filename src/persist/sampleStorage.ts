/**
 * Read / write sample binary assets in OPFS under `songs/<slug>/samples/<hash>.bin`.
 * No dependency on the audio layer — pure OPFS file I/O.
 */

/** Get the OPFS root directory handle (browser only). */
async function rootDir(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/** Resolve `songs/<slug>/samples/`, creating directories as needed. */
async function samplesDir(
  slug: string,
): Promise<{ dir: FileSystemDirectoryHandle; exists: boolean }> {
  const root = await rootDir()
  let songs: FileSystemDirectoryHandle
  try {
    songs = await root.getDirectoryHandle('songs')
  } catch {
    songs = await root.getDirectoryHandle('songs', { create: true })
  }
  let songDir: FileSystemDirectoryHandle
  try {
    songDir = await songs.getDirectoryHandle(slug)
  } catch {
    songDir = await songs.getDirectoryHandle(slug, { create: true })
  }
  let dir: FileSystemDirectoryHandle
  let exists = true
  try {
    dir = await songDir.getDirectoryHandle('samples')
  } catch {
    dir = await songDir.getDirectoryHandle('samples', { create: true })
    exists = false
  }
  return { dir, exists }
}

/** Store the raw audio file bytes under its content hash. */
export async function writeSampleAsset(
  slug: string,
  hash: string,
  file: File,
): Promise<void> {
  const { dir } = await samplesDir(slug)
  const fh = await dir.getFileHandle(`${hash}.bin`, { create: true })
  const writable = await fh.createWritable()
  await writable.write(await file.arrayBuffer())
  await writable.close()
}

/** Read stored sample bytes by hash. Returns null if not found. */
export async function readSampleAsset(
  slug: string,
  hash: string,
): Promise<ArrayBuffer | null> {
  const { dir } = await samplesDir(slug)
  let fh: FileSystemFileHandle
  try {
    fh = await dir.getFileHandle(`${hash}.bin`)
  } catch {
    return null
  }
  const file = await fh.getFile()
  return file.arrayBuffer()
}

/** Delete a stored sample by hash. No-op if not found. */
export async function deleteSampleAsset(slug: string, hash: string): Promise<void> {
  const { dir } = await samplesDir(slug)
  try {
    await dir.removeEntry(`${hash}.bin`)
  } catch {
    // Not found — no-op.
  }
}

/** List all sample hashes stored for a song. */
export async function listSampleAssets(slug: string): Promise<string[]> {
  const { dir, exists } = await samplesDir(slug)
  if (!exists) return []
  const hashes: string[] = []
  for await (const [name] of dir.entries()) {
    if (name.endsWith('.bin')) hashes.push(name.replace(/\.bin$/, ''))
  }
  return hashes
}
