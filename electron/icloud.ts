/** The app's iCloud Drive folder (the "Synthor" folder in iCloud Drive), through `native/icloud`. */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'

export const ICLOUD_CONTAINER = 'iCloud.nl.akiar.synthor'

export interface ICloudAddon {
  containerPath(identifier: string): Promise<string | null>
}

/** The addon from the app's Resources (packaged) or its build folder (dev); null where it doesn't exist. */
export function loadICloudAddon(candidates: string[], platform = process.platform): ICloudAddon | null {
  if (platform !== 'darwin') return null
  const require = createRequire(import.meta.url)
  for (const file of candidates) {
    try {
      return require(file) as ICloudAddon
    } catch {
      // Try the next location.
    }
  }
  return null
}

/**
 * The container's `Documents` folder (what iCloud Drive shows), created if needed; null when
 * iCloud Drive is off, the build isn't entitled, or there's no addon.
 */
export async function icloudDocumentsPath(addon: ICloudAddon | null): Promise<string | null> {
  if (!addon) return null
  try {
    const container = await addon.containerPath(ICLOUD_CONTAINER)
    if (!container) return null
    const docs = path.join(container, 'Documents')
    await fs.mkdir(docs, { recursive: true })
    return docs
  } catch (err) {
    console.warn('[icloud] container lookup failed:', err)
    return null
  }
}
