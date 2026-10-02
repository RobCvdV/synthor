import { useEffect } from 'react'
import { electronApi, type OpenedFile } from '../persist/electronBridge'
import { useProjectStore } from '../state/projectStore'
import { useSongBrowserStore } from '../state/songBrowserStore'
import { runAppCommand } from './appCommands'
import { OpenSongDialog } from './OpenSongDialog'
import { importSongData, openSavedSong } from './songActions'

/** Imports opened files one at a time, so each can settle the song before it. */
let fileChain: Promise<void> = Promise.resolve()
function openFiles(files: OpenedFile[]) {
  for (const file of files) {
    fileChain = fileChain.then(() => importSongData(file.bytes.slice().buffer as ArrayBuffer))
  }
}

/** Wires Electron's File menu and OS-opened song files to the song actions, and shows the Open Song dialog. Mount once the startup song is loaded. */
export function SongCommandHost() {
  const open = useSongBrowserStore((st) => st.open)
  const hide = useSongBrowserStore((st) => st.hide)
  const slug = useProjectStore((st) => st.slug)

  useEffect(() => {
    const api = electronApi()
    if (!api) return
    const offMenu = api.onMenuCommand((command) => void runAppCommand(command))
    const offFile = api.onFileOpened((file) => openFiles([file]))
    void api.takeOpenedFiles().then(openFiles)
    return () => { offMenu(); offFile() }
  }, [])

  if (!open) return null
  return (
    <OpenSongDialog currentSlug={slug} onClose={hide}
      onOpen={(s) => { hide(); void openSavedSong(s) }} />
  )
}
