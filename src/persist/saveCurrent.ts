import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { moveSongDir, saveRecent, writeSong } from './opfsStore'
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
 *
 * When the song has been renamed since the last save, the old OPFS directory
 * (including all samples) is moved to the new slug so no data is lost.
 */
export async function saveCurrentSong(): Promise<void> {
  const file = currentSongFile()
  const project = useProjectStore.getState()
  project.markSaving()
  try {
    const newSlug = project.slug
    const oldSlug = project.savedSlug

    // If the slug changed (song was renamed), move the old directory.
    if (oldSlug && oldSlug !== newSlug) {
      try {
        await moveSongDir(oldSlug, newSlug)
      } catch (err) {
        console.error('Failed to move song directory during rename:', err)
        // Don't fail the save — the song JSON still writes to the new slug.
        // Samples will need to be re-imported or moved manually.
      }
    }

    const slug = await writeSong(file, newSlug)
    // Remember this song so it auto-loads on the next startup.
    await saveRecent(slug)
    useProjectStore.getState().markSaved(file.meta.modifiedAt)
  } catch (err) {
    useProjectStore.getState().markError()
    throw err
  }
}
