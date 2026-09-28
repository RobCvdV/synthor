import { createDefaultDoc } from '../domain/factory'
import { isOpfsSupported, listSongs, readSong, saveRecent, slugify } from '../persist/opfsStore'
import { saveCurrentSong } from '../persist/saveCurrent'
import { importSongZip } from '../persist/songExport'
import { songNameConflict, uniqueSongName } from '../persist/songNames'
import { askConfirm, askText } from '../state/dialogStore'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'

async function savedSlugs(): Promise<string[]> {
  return isOpfsSupported() ? (await listSongs()).map((s) => s.slug) : []
}

/** Saves pending edits before switching songs; without storage, asks to discard them. */
export async function settleCurrentSong(): Promise<boolean> {
  if (useProjectStore.getState().status !== 'dirty') return true
  if (isOpfsSupported()) {
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
  if (isOpfsSupported()) await saveCurrentSong()
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
  if (isOpfsSupported()) await saveCurrentSong()
}
