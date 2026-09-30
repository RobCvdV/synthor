import { useEffect, useMemo, useState } from 'react'
import { listSongs } from '../persist/songStore'
import type { SongFile } from '../persist/serialize'
import { Button } from './components/Button'
import { Dialog } from './Dialog'
import s from './library/Library.module.css'

type Entry = { slug: string; meta: SongFile['meta'] }

/** Lists the saved songs to open one; search narrows by name. */
export function OpenSongDialog({ currentSlug, onOpen, onClose }: {
  currentSlug: string
  onOpen: (slug: string) => void
  onClose: () => void
}) {
  const [songs, setSongs] = useState<Entry[] | null>(null)
  const [text, setText] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | null>(null)

  useEffect(() => { void listSongs().then(setSongs, () => setSongs([])) }, [])

  const visible = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    return (songs ?? [])
      .filter((song) => words.every((w) => song.meta.name.toLowerCase().includes(w)))
      .sort((a, b) => a.meta.name.localeCompare(b.meta.name, undefined, { sensitivity: 'base' }))
  }, [songs, text])
  const open = (slug: string | null) => { if (slug) onOpen(slug) }

  return (
    <Dialog title="Open Song" onClose={onClose} className={s.narrowDialog}
      actions={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button active disabled={!activeSlug} onClick={() => open(activeSlug)}>Open</Button>
      </>}>
      <input className={`${s.search} ${s.searchBlock}`} type="search" placeholder="Search songs…" aria-label="Search songs" autoFocus
        value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') open(activeSlug ?? (visible.length === 1 ? visible[0].slug : null)) }} />
      <ul className={s.checklist}>
        {songs === null && <li className={s.empty}>Loading…</li>}
        {songs?.length === 0 && <li className={s.empty}>No saved songs yet.</li>}
        {songs && songs.length > 0 && visible.length === 0 && <li className={s.empty}>No songs match.</li>}
        {visible.map((song) => (
          <li key={song.slug} className={song.slug === activeSlug ? `${s.row} ${s.active}` : s.row}
            onClick={() => setActiveSlug(song.slug)} onDoubleClick={() => open(song.slug)}>
            <span className={s.name}>{song.meta.name}</span>
            {song.slug === currentSlug && <span className="muted">open now</span>}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
