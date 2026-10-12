/** `settings.json` in userData: app config plus the renderer's key-value store. */
import fs from 'node:fs'
import path from 'node:path'

export interface AppSettings {
  /** Library folder; defaults to ~/Documents/Synthor. */
  libraryPath?: string
  /** The library was moved into the app's iCloud Drive folder. */
  icloudLibrary?: boolean
  /** Renderer origins whose browser-storage songs were already copied to disk (dev and packaged differ). */
  importedBrowserOrigins?: string[]
  /** Renderer key-value store (zustand persist). */
  store: Record<string, string>
}

const WRITE_DELAY_MS = 300

export function loadSettings(file: string): AppSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppSettings>
    return { ...parsed, store: parsed.store ?? {} }
  } catch {
    return { store: {} }
  }
}

/** Keeps settings in memory and writes them back debounced; `flush` before quit. */
export function createSettingsFile(file: string) {
  const settings = loadSettings(file)
  let timer: ReturnType<typeof setTimeout> | null = null

  const write = () => {
    timer = null
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
    fs.renameSync(tmp, file)
  }

  const scheduleWrite = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, WRITE_DELAY_MS)
  }

  /** Writes now if a write is pending. */
  const flush = () => {
    if (!timer) return
    clearTimeout(timer)
    write()
  }

  return {
    settings,
    flush,
    update(patch: Partial<Omit<AppSettings, 'store'>>) {
      Object.assign(settings, patch)
      scheduleWrite()
    },
    setItem(key: string, value: string | null) {
      if (value === null) delete settings.store[key]
      else settings.store[key] = value
      scheduleWrite()
    },
  }
}

export type SettingsFile = ReturnType<typeof createSettingsFile>
