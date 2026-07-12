import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { writeSong } from './opfsStore'
import { makeSongFile, type SongFile } from './serialize'

/** Build a SongFile snapshot from the current doc + project identity. */
export function currentSongFile(): SongFile {
  const { doc } = useDocStore.getState()
  const { name, createdAt } = useProjectStore.getState()
  return makeSongFile(doc, { name, createdAt, modifiedAt: new Date().toISOString() })
}

/**
 * Persist the current song to OPFS and update save status. The single write
 * path shared by autosave and the manual Save button. Rethrows on failure
 * after marking the error, so callers can react if they want to.
 */
export async function saveCurrentSong(): Promise<void> {
  const file = currentSongFile()
  const project = useProjectStore.getState()
  project.markSaving()
  try {
    await writeSong(file)
    useProjectStore.getState().markSaved(file.meta.modifiedAt)
  } catch (err) {
    useProjectStore.getState().markError()
    throw err
  }
}
