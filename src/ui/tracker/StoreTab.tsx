import { useCallback, useEffect, useState } from 'react'
import { useProjectStore } from '../../state/projectStore'
import { askConfirm } from '../../state/dialogStore'
import { deleteSong, listSongs } from '../../persist/songStore'
import { hasStorage } from '../../persist/storage'
import { electronApi } from '../../persist/electronBridge'
import { connectedFolderName, isFolderAccessSupported } from '../../persist/webFolder'
import { backupLibrary, restoreLibrary, stopUsingFolder, moveLibraryToFolder } from '../libraryLocationActions'
import { currentSongFile, saveCurrentSong } from '../../persist/saveCurrent'
import { serializeSong, type SongFile } from '../../persist/serialize'
import { downloadBlob } from '../download'
import { saveLabel, tildePath } from '../format'
import { createNewSong, exportCurrentSong, importSongFromPicker, openSavedSong } from '../songActions'
import { Button } from '../components/Button'

type Entry = { slug: string; meta: SongFile['meta'] }

/* ------------------------------------------------------------------ */
/*  Store tab — new, open, save, import, export                        */
/* ------------------------------------------------------------------ */

export function StoreTab() {
  const name = useProjectStore((s) => s.name)
  const status = useProjectStore((s) => s.status)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)

  const [songs, setSongs] = useState<Entry[]>([])
  const opfs = hasStorage()

  // Every save (autosave, rename, new song) can change the list.
  const refreshList = useCallback(() => {
    if (opfs) void listSongs().then(setSongs)
  }, [opfs])
  useEffect(refreshList, [refreshList, lastSavedAt])

  const removeSong = async (s: string) => {
    if (!await askConfirm({ message: `Delete "${s}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return
    await deleteSong(s)
    refreshList()
  }

  const saveSong = async () => {
    try {
      await saveCurrentSong()
      refreshList()
    } catch { /* ignore */ }
  }

  const exportJson = () => {
    const file = currentSongFile()
    const blob = new Blob([serializeSong(file)], { type: 'application/json' })
    downloadBlob(blob, `${name || 'song'}.synthor.json`)
  }

  return (
    <div className="store-tab">
      <div className="store-status">
        <span className={'store-status-label' + (status === 'error' ? ' error' : '') + (status === 'dirty' ? ' dirty' : '')}>
          {saveLabel(status, lastSavedAt)}
        </span>
      </div>

      <div className="store-actions">
        <Button size="sm" onClick={() => void createNewSong()} title="Create a new empty song">New</Button>
        {opfs && (
          <Button size="sm" onClick={() => void saveSong()} title="Save current song">Save</Button>
        )}
        <Button size="sm" onClick={() => void exportCurrentSong()} title="Export as .synthor (includes samples)">Export</Button>
        <Button size="sm" onClick={exportJson} title="JSON only, no sample data">Export JSON</Button>
        <Button size="sm" onClick={() => void importSongFromPicker()} title="Import .synthor or .json">Import</Button>
      </div>

      {opfs && (
        <div className="store-list">
          <h4 className="store-list-title">Saved Songs</h4>
          <StorageLocation onRestored={refreshList} />
          {songs.length === 0 && <p className="muted">No saved songs yet.</p>}
          <ul className="store-song-list">
            {songs.map((s) => (
              <li key={s.slug} className="store-song-item">
                <span
                  className="store-song-name"
                  title="Click to open"
                  onClick={() => void openSavedSong(s.slug)}
                >
                  {s.meta.name}
                </span>
                <span className="muted store-song-date">
                  {new Date(s.meta.createdAt).toLocaleDateString()}
                </span>
                <button
                  className="arrange-del-btn"
                  title="Delete song permanently"
                  onClick={() => void removeSong(s.slug)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Where the library lives (Electron folder, a connected web folder, or browser storage), plus backup and restore. */
export function StorageLocation({ onRestored }: { onRestored?: () => void }) {
  const api = electronApi()
  const folder = connectedFolderName()
  let where
  if (api) {
    where = (
      <p className="muted store-location">
        <span className="store-location-path" title={api.libraryPath}>{tildePath(api.libraryPath)}</span>
        <Button size="sm" onClick={() => void api.revealLibrary()} title="Show the library folder">Reveal</Button>
      </p>
    )
  } else if (folder) {
    where = (
      <p className="muted store-location">
        <span className="store-location-path" title="The library is kept in this folder">Folder: {folder}</span>
        <Button size="sm" onClick={() => void stopUsingFolder()} title="Keep the library in this browser again">Disconnect</Button>
      </p>
    )
  } else {
    where = (
      <p className="muted store-location">
        <span className="store-location-path">Stored in this browser</span>
        {isFolderAccessSupported() && (
          <Button size="sm" onClick={() => void moveLibraryToFolder()} title="Keep the library in a folder on your computer">Use a folder…</Button>
        )}
      </p>
    )
  }
  return (
    <>
      {where}
      <p className="muted store-location">
        <Button size="sm" onClick={() => void backupLibrary()} title="Download all songs, instruments and samples as one zip">Back up library</Button>
        <Button size="sm" onClick={() => void restoreLibrary().then((changed) => { if (changed) onRestored?.() })}
          title="Add songs, instruments and samples from a backup zip">Restore…</Button>
      </p>
    </>
  )
}
