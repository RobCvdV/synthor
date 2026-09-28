import { useCallback, useEffect, useState } from 'react'
import { useProjectStore } from '../state/projectStore'
import { askConfirm } from '../state/dialogStore'
import { deleteSong, isOpfsSupported, listSongs } from '../persist/opfsStore'
import { currentSongFile, saveCurrentSong } from '../persist/saveCurrent'
import { serializeSong, type SongFile } from '../persist/serialize'
import { exportSongZip } from '../persist/songExport'
import { downloadBlob } from './download'
import { pickFiles } from './pickFiles'
import { saveLabel } from './format'
import { createNewSong, importSongFile, openSavedSong } from './songActions'
import { Button } from './components/Button'

type Entry = { slug: string; meta: SongFile['meta'] }

/* ------------------------------------------------------------------ */
/*  Store tab — new, open, save, import, export                        */
/* ------------------------------------------------------------------ */

export function StoreTab({ slug }: { slug: string }) {
  const name = useProjectStore((s) => s.name)
  const status = useProjectStore((s) => s.status)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)

  const [songs, setSongs] = useState<Entry[]>([])
  const opfs = isOpfsSupported()

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

  const exportZip = async () => {
    try {
      const file = currentSongFile()
      const blob = await exportSongZip(file, slug)
      downloadBlob(blob, `${name || 'song'}.synthor`)
    } catch (err) {
      console.error('Export failed:', err)
      alert(`Export failed: ${(err as Error).message}`)
    }
  }

  const exportJson = () => {
    const file = currentSongFile()
    const blob = new Blob([serializeSong(file)], { type: 'application/json' })
    downloadBlob(blob, `${name || 'song'}.synthor.json`)
  }

  const importSong = async () => {
    const [f] = await pickFiles({ accept: '.synthor,.json,application/json,application/zip' })
    if (!f) return
    try {
      await importSongFile(await f.arrayBuffer())
    } catch (err) {
      console.error('Import failed:', err)
      alert(`Could not import song: ${(err as Error).message}`)
    }
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
        <Button size="sm" onClick={exportZip} title="Export as .synthor (includes samples)">Export</Button>
        <Button size="sm" onClick={exportJson} title="JSON only, no sample data">Export JSON</Button>
        <Button size="sm" onClick={() => void importSong()} title="Import .synthor or .json">Import</Button>
      </div>

      {opfs && (
        <div className="store-list">
          <h4 className="store-list-title">Saved Songs</h4>
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
