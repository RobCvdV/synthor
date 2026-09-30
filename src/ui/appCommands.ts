import { electronApi, type AppCommand } from '../persist/electronBridge'
import { useSongBrowserStore } from '../state/songBrowserStore'
import { createNewSong, exportCurrentSong, importSongFromPicker, saveCurrentSongAs, saveNow } from './songActions'

/** Runs a File-menu command (Electron menu, or the web's ⌘S / ⇧⌘S / ⌘O). */
export async function runAppCommand(command: AppCommand): Promise<void> {
  switch (command) {
    case 'newSong': return createNewSong()
    case 'openSong': return useSongBrowserStore.getState().show()
    case 'save': return saveNow()
    case 'saveAs': return saveCurrentSongAs()
    case 'importSong': return importSongFromPicker()
    case 'exportSong': return exportCurrentSong()
    case 'revealLibrary': await electronApi()?.revealLibrary()
  }
}

/** The web's file shortcuts; Electron's menu accelerators cover them there. */
export function fileShortcut(e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): AppCommand | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
  if (e.code === 'KeyS') return e.shiftKey ? 'saveAs' : 'save'
  if (e.code === 'KeyO' && !e.shiftKey) return 'openSong'
  return null
}
