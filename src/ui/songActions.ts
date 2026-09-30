import { createDefaultDoc } from '../domain/factory'
import { copyTree, hasStorage, joinPath, requireStorage } from '../persist/storage'
import { listSongs, loadRecent, readSong, saveRecent, slugify, songDir } from '../persist/songStore'
import { currentSongFile, saveCurrentSong } from '../persist/saveCurrent'
import { importBrowserStorageOnce } from '../persist/importBrowserStorage'
import { openSavedFolder } from '../persist/webFolder'
import { exportSongZip, importSongZip } from '../persist/songExport'
import { songNameConflict, uniqueSongName } from '../persist/songNames'
import { clampCursor, useAppStore } from '../state/appStore'
import { askConfirm, askText } from '../state/dialogStore'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { downloadBlob } from './download'
import { pickFiles } from './pickFiles'

async function savedSlugs(): Promise<string[]> {
  return hasStorage() ? (await listSongs()).map((s) => s.slug) : []
}

/** Saves pending edits before switching songs; without storage, asks to discard them. */
export async function settleCurrentSong(): Promise<boolean> {
  if (useProjectStore.getState().status !== 'dirty') return true
  if (hasStorage()) {
    await saveCurrentSong()
    return true
  }
  return askConfirm({ message: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true })
}

/** Asks for a free name, then starts and saves an empty song under it. */
export async function createNewSong(): Promise<void> {
  const taken = await savedSlugs()
  const name = await askText({
    message: 'Name for the new song',
    defaultValue: uniqueSongName('Untitled', taken),
    confirmLabel: 'Create',
    validate: (v) => songNameConflict(v, taken),
  })
  if (name === null || !await settleCurrentSong()) return
  useDocStore.getState().loadDoc(createDefaultDoc())
  useProjectStore.getState().reset(name, new Date().toISOString())
  if (hasStorage()) await saveCurrentSong()
}

/** Renames the open song; a name another song uses asks for a different one. */
export async function renameCurrentSong(name: string): Promise<void> {
  const { slug } = useProjectStore.getState()
  const taken = await savedSlugs()
  let next: string | null = name.trim()
  if (songNameConflict(next, taken, slug)) {
    next = await askText({
      message: `"${next}" is already used by another song. Choose a different name.`,
      defaultValue: next,
      confirmLabel: 'Rename',
      validate: (v) => songNameConflict(v, taken, slug),
    })
  }
  if (next !== null && next !== useProjectStore.getState().name) useProjectStore.getState().setName(next)
}

/** Opens a saved song after settling the current one. */
export async function openSavedSong(slug: string): Promise<void> {
  const file = await readSong(slug)
  if (!file || !await settleCurrentSong()) return
  useDocStore.getState().loadDoc(file.doc)
  useProjectStore.getState().reset(file.meta.name, file.meta.createdAt, slug)
  await saveRecent(slug)
}

/** Imports a `.synthor` or JSON song as a new song, renamed if its name is taken. */
export async function importSongFile(data: ArrayBuffer): Promise<void> {
  if (!await settleCurrentSong()) return
  const taken = await savedSlugs()
  let name = ''
  const { file, slug } = await importSongZip(data, (f) => {
    name = uniqueSongName(f.meta.name, taken)
    return slugify(name)
  })
  useDocStore.getState().loadDoc(file.doc)
  useProjectStore.getState().reset(name, file.meta.createdAt, slug)
  if (hasStorage()) await saveCurrentSong()
}

/** Saves the open song under a new name and continues in the copy; the original stays as last saved. */
export async function saveCurrentSongAs(): Promise<void> {
  if (!hasStorage()) return
  const taken = await savedSlugs()
  const { name, slug } = useProjectStore.getState()
  const next = await askText({
    message: 'Save the song as',
    defaultValue: uniqueSongName(`${name} copy`, taken),
    confirmLabel: 'Save',
    validate: (v) => songNameConflict(v, taken),
  })
  if (next === null) return
  const s = requireStorage()
  await copyTree(s, joinPath(songDir(slug), 'samples'), s, joinPath(songDir(slugify(next)), 'samples'))
  useProjectStore.getState().reset(next, new Date().toISOString())
  await saveCurrentSong()
}

/** Saves now (autosave does this too, shortly after edits). */
export async function saveNow(): Promise<void> {
  if (hasStorage()) await saveCurrentSong().catch(() => {})
}

/** Picks a `.synthor` / JSON file and imports it as a new song. */
export async function importSongFromPicker(): Promise<void> {
  const [f] = await pickFiles({ accept: '.synthor,.json,application/json,application/zip' })
  if (f) await importSongData(await f.arrayBuffer())
}

/** Imports song data as a new song, reporting failures instead of throwing. */
export async function importSongData(data: ArrayBuffer): Promise<void> {
  try {
    await importSongFile(data)
  } catch (err) {
    console.error('Import failed:', err)
    alert(`Could not import song: ${(err as Error).message}`)
  }
}

/** Downloads the open song as a `.synthor` file with its samples. */
export async function exportCurrentSong(): Promise<void> {
  try {
    const { name, slug } = useProjectStore.getState()
    downloadBlob(await exportSongZip(currentSongFile(), slug), `${name || 'song'}.synthor`)
  } catch (err) {
    console.error('Export failed:', err)
    alert(`Export failed: ${(err as Error).message}`)
  }
}

/** Opens the song from the last session, or names the default song; then fits the saved UI state to it. */
export async function loadStartupSong(): Promise<void> {
  try {
    await openSavedFolder((folder) => askConfirm({
      message: `Your library is in the folder “${folder}”. The browser needs your permission again to use it.`,
      confirmLabel: 'Reconnect',
      cancelLabel: 'Use browser storage',
    }))
    await importBrowserStorageOnce()
    const slug = await loadRecent()
    const file = slug ? await readSong(slug) : null
    if (slug && file) {
      let doc = file.doc
      if (!doc.entities.patterns[doc.patternId]) {
        const firstPat = Object.keys(doc.entities.patterns)[0]
        if (firstPat) doc = { ...doc, patternId: firstPat }
      }
      useProjectStore.getState().reset(file.meta.name, file.meta.createdAt, slug)
      useDocStore.getState().loadDoc(doc)
    } else if (!slug) {
      useProjectStore.getState().reset('Untitled', new Date().toISOString())
    }
  } catch (err) {
    console.error('Failed to load recent song:', err)
  }
  const app = useAppStore.getState()
  const { doc } = useDocStore.getState()
  const pattern = doc.entities.patterns[doc.patternId]
  if (pattern) app.setTrackerCursor(clampCursor(app.trackerCursor, pattern, doc))
  if (!app.selectedInstrumentId || !doc.entities.instruments[app.selectedInstrumentId]) {
    app.setSelectedInstrumentId(Object.keys(doc.entities.instruments)[0] ?? null)
  }
}
