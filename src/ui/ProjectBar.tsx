import { useCallback, useEffect, useRef, useState } from 'react'
import { createDefaultDoc } from '../domain/factory'
import { deleteSong, isOpfsSupported, listSongs, readSong } from '../persist/opfsStore'
import { currentSongFile, saveCurrentSong } from '../persist/saveCurrent'
import { deserializeSong, serializeSong, type SongFile } from '../persist/serialize'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'

type Entry = { slug: string; meta: SongFile['meta'] }

/** Toolbar for song identity + persistence: name, save status, open/new/import/export. */
export function ProjectBar() {
  const name = useProjectStore((s) => s.name)
  const status = useProjectStore((s) => s.status)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)
  const setName = useProjectStore((s) => s.setName)
  const reset = useProjectStore((s) => s.reset)
  const loadDoc = useDocStore((s) => s.loadDoc)

  const [songs, setSongs] = useState<Entry[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const opfs = isOpfsSupported()

  const refreshList = useCallback(() => {
    if (opfs) void listSongs().then(setSongs)
  }, [opfs])
  useEffect(refreshList, [refreshList])

  const loadFile = useCallback(
    (file: SongFile) => {
      loadDoc(file.doc)
      reset(file.meta.name, file.meta.createdAt)
    },
    [loadDoc, reset],
  )

  const newSong = () => {
    if (status === 'dirty' && !confirm('Discard unsaved changes and start a new song?')) return
    loadDoc(createDefaultDoc())
    reset('Untitled', new Date().toISOString())
  }

  const openSong = async (slug: string) => {
    if (!slug) return
    const file = await readSong(slug)
    if (file) loadFile(file)
  }

  const removeSong = async (slug: string) => {
    if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return
    await deleteSong(slug)
    refreshList()
  }

  const exportSong = () => {
    const file = currentSongFile()
    const blob = new Blob([serializeSong(file)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || 'song'}.synthor.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importSong = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!f) return
    try {
      loadFile(deserializeSong(await f.text()))
    } catch (err) {
      alert(`Could not import song: ${(err as Error).message}`)
    }
  }

  return (
    <div className="projectbar">
      <input
        className="song-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Song name"
      />
      <SaveIndicator status={status} lastSavedAt={lastSavedAt} opfs={opfs} />
      <span className="spacer" />
      <button onClick={newSong}>New</button>
      {opfs && (
        <select
          className="open-select"
          value=""
          onFocus={refreshList}
          onChange={(e) => void openSong(e.target.value)}
          aria-label="Open song"
        >
          <option value="">Open…</option>
          {songs.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.meta.name}
            </option>
          ))}
        </select>
      )}
      {opfs && (
        <button onClick={() => void saveCurrentSong().then(refreshList).catch(() => {})}>Save</button>
      )}
      <button onClick={exportSong}>Export</button>
      <button onClick={() => fileInput.current?.click()}>Import</button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void importSong(e)}
      />
      {opfs && songs.length > 0 && (
        <select
          className="open-select"
          value=""
          onChange={(e) => e.target.value && void removeSong(e.target.value)}
          aria-label="Delete song"
        >
          <option value="">Delete…</option>
          {songs.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.meta.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function SaveIndicator({
  status,
  lastSavedAt,
  opfs,
}: {
  status: string
  lastSavedAt: string | null
  opfs: boolean
}) {
  if (!opfs) return <span className="muted save-status">export/import only</span>
  const label =
    status === 'saving'
      ? 'saving…'
      : status === 'error'
        ? '⚠ save failed'
        : status === 'dirty'
          ? 'unsaved'
          : lastSavedAt
            ? `saved ${new Date(lastSavedAt).toLocaleTimeString()}`
            : 'not saved yet'
  return <span className={'muted save-status' + (status === 'error' ? ' error' : '')}>{label}</span>
}
