import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from './state/docStore'
import { rowHz, useTransportStore } from './state/transportStore'
import { useEngine } from './ui/useEngine'
import { useAutosave } from './ui/useAutosave'
import { codeToSemitone } from './ui/keymap'
import { TrackerGrid, type Cursor } from './ui/TrackerGrid'
import { ProjectBar } from './ui/ProjectBar'
import { Legend } from './ui/Legend'
import { InstrumentsView } from './ui/InstrumentsView'
import { loadRecent, readSong } from './persist/opfsStore'
import { useProjectStore } from './state/projectStore'

/** True when a keystroke should go to a focused form field, not the tracker.
 *  Range sliders are excluded — they can't receive text, and we want global
 *  shortcuts (transport, undo/redo) to work while tweaking sliders. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') return el.type !== 'range'
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function App() {
  const host = useEngine()
  useAutosave()

  // On first mount, try to restore the last-opened song so the user picks up
  // where they left off instead of landing on the default test pattern.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      const slug = await loadRecent()
      if (!slug) return
      const file = await readSong(slug)
      if (!file) return
      // Update project identity BEFORE loading the doc, so the autosave that
      // fires on loadDoc uses the right song name + doesn't overwrite the
      // recent slug with "untitled".
      useProjectStore.getState().reset(file.meta.name, file.meta.createdAt)
      useDocStore.getState().loadDoc(file.doc)
    })()
  }, [])

  const doc = useDocStore((s) => s.doc)
  const setCellNote = useDocStore((s) => s.setCellNote)
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  const addTrack = useDocStore((s) => s.addTrack)
  const removeTrack = useDocStore((s) => s.removeTrack)
  const moveTrack = useDocStore((s) => s.moveTrack)
  const copyTrack = useDocStore((s) => s.copyTrack)
  const pasteTrack = useDocStore((s) => s.pasteTrack)
  const duplicateTrack = useDocStore((s) => s.duplicateTrack)
  const shiftTrack = useDocStore((s) => s.shiftTrack)
  const toggleMute = useDocStore((s) => s.toggleMute)
  const mutedTracks = useDocStore((s) => s.mutedTracks)

  const playing = useTransportStore((s) => s.playing)
  const bpm = useTransportStore((s) => s.bpm)
  const linesPerBeat = useTransportStore((s) => s.linesPerBeat)
  const toggle = useTransportStore((s) => s.toggle)

  const pattern = doc.entities.patterns[doc.patternId]
  const [cursor, setCursor] = useState<Cursor>({ row: 0, track: 0 })
  const [octave, setOctave] = useState(5)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [view, setView] = useState<'tracker' | 'instruments'>('tracker')

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const octaveRef = useRef(octave)
  octaveRef.current = octave

  // Keep the cursor track in range as tracks come and go.
  const trackCount = pattern.trackIds.length
  useEffect(() => {
    setCursor((c) => (c.track >= trackCount ? { ...c, track: Math.max(0, trackCount - 1) } : c))
  }, [trackCount])

  // Visual playhead: derived from the shared AudioContext clock while playing.
  // (A known approximation — will be replaced by an el.snapshot tap later.)
  useEffect(() => {
    if (!playing) {
      setPlayhead(null)
      return
    }
    let raf = 0
    const tick = () => {
      setPlayhead(Math.floor(host.currentTime * rowHz(bpm, linesPerBeat)) % pattern.length)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, bpm, linesPerBeat, pattern.length, host])

  /** Count of tracks in the current pattern right now (post-mutation reads). */
  const liveTrackCount = () => useDocStore.getState().doc.entities.patterns[doc.patternId].trackIds.length

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't hijack keys while the user is typing in a form field (e.g. the
      // song-name box) — let the input handle them normally.
      if (isEditableTarget(e.target)) return

      const cur = cursorRef.current
      const ids = pattern.trackIds
      const trackId = ids[cur.track]

      // Transport (spacebar) — also the user gesture that boots audio.
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        void host.start().then(toggle)
        return
      }

      // Undo / redo (Cmd on macOS, Ctrl elsewhere).
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }

      // In the instruments view the tracker keymap is inert (transport + undo
      // above still work globally); form fields handle their own keys.
      if (view === 'instruments') return

      // Mute toggle: F1..F12 -> tracks 1..12 (when they exist).
      const fkey = /^F([1-9]|1[0-2])$/.exec(e.code)
      if (fkey) {
        e.preventDefault()
        const id = ids[Number(fkey[1]) - 1]
        if (id) toggleMute(id)
        return
      }

      // Track operations — all on Ctrl (per design). Ctrl swallows note entry.
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.code) {
          case 'Comma': // Ctrl+,  move left  / Ctrl+Shift+,  insert left
            e.preventDefault()
            if (e.shiftKey) {
              // Inherit the cursor track's instrument, fall back to any other,
              // or auto-create one as a last resort.
              const inheritId =
                useDocStore.getState().doc.entities.tracks[trackId]?.instrumentId ??
                Object.keys(useDocStore.getState().doc.entities.instruments)[0] ??
                useDocStore.getState().addInstrument('osc')
              addTrack(cur.track, inheritId)
              setCursor((c) => ({ ...c, track: cur.track }))
            } else {
              moveTrack(cur.track, cur.track - 1)
              setCursor((c) => ({ ...c, track: Math.max(0, cur.track - 1) }))
            }
            return
          case 'Period': // Ctrl+.  move right / Ctrl+Shift+.  insert right
            e.preventDefault()
            if (e.shiftKey) {
              // Inherit the cursor track's instrument (same logic as above).
              const inheritId =
                useDocStore.getState().doc.entities.tracks[trackId]?.instrumentId ??
                Object.keys(useDocStore.getState().doc.entities.instruments)[0] ??
                useDocStore.getState().addInstrument('osc')
              addTrack(cur.track + 1, inheritId)
              setCursor((c) => ({ ...c, track: cur.track + 1 }))
            } else {
              moveTrack(cur.track, cur.track + 1)
              setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) }))
            }
            return
          case 'KeyC':
            e.preventDefault()
            if (trackId) copyTrack(trackId)
            return
          case 'KeyV':
            e.preventDefault()
            pasteTrack(cur.track + 1)
            setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) }))
            return
          case 'KeyD':
            e.preventDefault()
            if (trackId) {
              duplicateTrack(trackId, cur.track + 1)
              setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) }))
            }
            return
          case 'KeyX': // Ctrl+X  cut = copy to pasteboard, then remove
            e.preventDefault()
            if (trackId) {
              copyTrack(trackId)
              removeTrack(trackId)
              setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) }))
            }
            return
          case 'Backspace': // Ctrl+⌫  delete = remove without touching pasteboard
            e.preventDefault()
            if (trackId) {
              removeTrack(trackId)
              setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) }))
            }
            return
          case 'ArrowUp': // Ctrl+↑  shift track content up (wraps)
            e.preventDefault()
            if (trackId) shiftTrack(trackId, 'up')
            return
          case 'ArrowDown': // Ctrl+↓  shift track content down (wraps)
            e.preventDefault()
            if (trackId) shiftTrack(trackId, 'down')
            return
        }
        return // any other Ctrl combo: don't fall through to note entry
      }

      // Cursor navigation.
      if (e.code === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        return
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => ({ ...c, row: (c.row - 1 + pattern.length) % pattern.length }))
        return
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        setCursor((c) => (ids.length ? { ...c, track: (c.track + 1) % ids.length } : c))
        return
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setCursor((c) => (ids.length ? { ...c, track: (c.track - 1 + ids.length) % ids.length } : c))
        return
      }

      // Octave shift ( - / = ), kept off the note map so [ ] stay as notes.
      if (e.code === 'Minus') { e.preventDefault(); setOctave((o) => Math.max(0, o - 1)); return }
      if (e.code === 'Equal') { e.preventDefault(); setOctave((o) => Math.min(9, o + 1)); return }

      // Clear cell.
      if (e.code === 'Delete') {
        e.preventDefault()
        if (trackId) setCellNote(trackId, cur.row, null)
        setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        return
      }

      // Note entry (no modifiers).
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const semi = codeToSemitone(e.code)
        if (semi !== undefined && trackId) {
          e.preventDefault()
          setCellNote(trackId, cur.row, octaveRef.current * 12 + semi)
          setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        }
      }
    },
    [view, pattern, host, toggle, undo, redo, setCellNote, addTrack, removeTrack, moveTrack, copyTrack, pasteTrack, duplicateTrack, shiftTrack, toggleMute],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <div className="app">
      <header className="toolbar">
        <strong>synthor</strong>
        <span className={'badge' + (playing ? ' on' : '')}>{playing ? '▶ playing' : '■ stopped'}</span>
        <span className="muted">{bpm} BPM · 1/{linesPerBeat * 4}</span>
        <span className="muted">oct {octave}</span>
        <span className="muted">{trackCount} tracks</span>
        <span className="spacer" />
        <button
          className={'octbtn' + (view === 'tracker' ? ' active' : '')}
          onClick={() => setView('tracker')}
        >
          Tracker
        </button>
        <button
          className={'octbtn' + (view === 'instruments' ? ' active' : '')}
          onClick={() => setView('instruments')}
        >
          Instruments
        </button>
        {view === 'tracker' && (
          <>
            <button className="octbtn" onClick={() => setOctave((o) => Math.max(0, o - 1))}>oct −</button>
            <button className="octbtn" onClick={() => setOctave((o) => Math.min(9, o + 1))}>oct +</button>
          </>
        )}
      </header>
      <ProjectBar />
      {view === 'tracker' ? (
        <div className="layout">
          <main className="main">
            <TrackerGrid doc={doc} pattern={pattern} cursor={cursor} playhead={playhead} muted={mutedTracks} />
          </main>
          <Legend />
        </div>
      ) : (
        <div className="layout">
          <InstrumentsView host={host} />
        </div>
      )}
    </div>
  )
}
