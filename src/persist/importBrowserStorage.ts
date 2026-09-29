/** One-time copy of songs saved in browser storage (OPFS) into the Electron library folder. */
import { electronApi } from './electronBridge'
import { createOpfsBackend, isOpfsSupported } from './opfsBackend'
import { copyTree, storage, type StorageBackend } from './storage'

const COPIED_PATHS = ['songs', 'recent']

let imported = false

/** Copies songs and the recent-song marker; anything already in `to` is kept. */
export async function importStorage(from: StorageBackend, to: StorageBackend): Promise<void> {
  for (const path of COPIED_PATHS) {
    const entries = await from.list(path)
    if (entries.length > 0) {
      await copyTree(from, path, to, path)
    } else if (!await to.exists(path)) {
      const data = await from.readBytes(path)
      if (data) await to.write(path, data)
    }
  }
}

/** Runs the import once per renderer origin in Electron; failures retry next launch. */
export async function importBrowserStorageOnce(): Promise<void> {
  const api = electronApi()
  if (!api || imported) return
  const origin = location.origin
  const disk = storage()
  if (api.importedBrowserOrigins.includes(origin) || !disk || !isOpfsSupported()) return
  try {
    await importStorage(createOpfsBackend(), disk)
    await api.markBrowserStorageImported(origin)
    imported = true
  } catch (err) {
    console.error('Importing browser-stored songs failed:', err)
  }
}
