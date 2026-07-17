import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from './state/docStore'
import { rowHz, useTransportStore } from './state/transportStore'
import { useEngine } from './ui/useEngine'
import { useAutosave } from './ui/useAutosave'
import { codeToSemitone } from './ui/keymap'
import { TrackerGrid, type Cursor, type Selection } from './ui/TrackerGrid'
import { SongBar } from './ui/SongBar'
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
      try {
        const slug = await loadRecent()
        if (!slug) return
        const file = await readSong(slug)
        if (!file) return
        // Validate: ensure the doc's patternId points to an actual pattern.
        // If the migration produced an inconsistent state, fall back to the
        // first available pattern.
        let doc = file.doc
        if (!doc.entities.patterns[doc.patternId]) {
          const firstPat = Object.keys(doc.entities.patterns)[0]
          if (firstPat) doc = { ...doc, patternId: firstPat }
        }
        // Update project identity BEFORE loading the doc, so the autosave that
        // fires on loadDoc uses the right song name + doesn't overwrite the
        // recent slug with "untitled".
        useProjectStore.getState().reset(file.meta.name, file.meta.createdAt)
        useDocStore.getState().loadDoc(doc)
      } catch (err) {
        console.error('Failed to load recent song:', err)
      }
    })()
  }, [])

  const doc = useDocStore((s) => s.doc)
  const setCellNote = useDocStore((s) => s.setCellNote)
  const setCellNoteOff = useDocStore((s) => s.setCellNoteOff)
  const setCellVolume = useDocStore((s) => s.setCellVolume)
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
  const copyRect = useDocStore((s) => s.copyRect)
  const cutRect = useDocStore((s) => s.cutRect)
  const pasteRect = useDocStore((s) => s.pasteRect)
  const mutedTracks = useDocStore((s) => s.mutedTracks)

  const projectName = useProjectStore((s) => s.name)
  const playing = useTransportStore((s) => s.playing)
  const bpm = useTransportStore((s) => s.bpm)
  const linesPerBeat = useTransportStore((s) => s.linesPerBeat)
  const toggle = useTransportStore((s) => s.toggle)

  const pattern = doc.entities.patterns[doc.patternId]
  const [cursor, setCursor] = useState<Cursor>({ row: 0, track: 0, col: 0 })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [octave, setOctave] = useState(5)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [view, setView] = useState<'tracker' | 'instruments'>('tracker')

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const octaveRef = useRef(octave)
  octaveRef.current = octave
  /** Pending high nibble for two-digit hex volume entry (0-15), or null. */
  const volumeEntryRef = useRef<number | null>(null)
  const [volumeEntry, setVolumeEntry] = useState<number | null>(null)

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

  const onCellClick = useCallback((row: number, track: number, shiftKey: boolean) => {
    setVolumeEntry(null)
    volumeEntryRef.current = null
    if (shiftKey) {
      const sel = selectionRef.current
      if (sel) {
        setSelection({ ...sel, endRow: row, endTrack: track })
      } else {
        const cur = cursorRef.current
        setSelection({ startRow: cur.row, startTrack: cur.track, endRow: row, endTrack: track })
      }
    } else {
      setSelection(null)
    }
    setCursor((c) => ({ ...c, row, track }))
  }, [])

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
          case 'KeyC': {
            e.preventDefault()
            const sel = selectionRef.current
            if (sel) {
              copyRect(ids, sel.startRow, sel.endRow, sel.startTrack, sel.endTrack)
            } else if (trackId) {
              copyTrack(trackId)
            }
            return
          }
          case 'KeyV': {
            e.preventDefault()
            const rectClip = useDocStore.getState().rectClipboard
            if (rectClip) {
              pasteRect(ids, cur.row, cur.track)
            } else {
              pasteTrack(cur.track + 1)
              setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) }))
            }
            return
          }
          case 'KeyD':
            e.preventDefault()
            if (trackId) {
              duplicateTrack(trackId, cur.track + 1)
              setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) }))
            }
            return
          case 'KeyX': {
            e.preventDefault()
            const sel = selectionRef.current
            if (sel) {
              cutRect(ids, sel.startRow, sel.endRow, sel.startTrack, sel.endTrack)
              setSelection(null)
            } else if (trackId) {
              copyTrack(trackId)
              removeTrack(trackId)
              setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) }))
            }
            return
          }
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

      // Cursor navigation — all arrow keys cancel pending volume entry.
      if (e.code === 'ArrowDown') {
        e.preventDefault()
        setVolumeEntry(null); volumeEntryRef.current = null
        setCursor((c) => {
          const next = { ...c, row: (c.row + 1) % pattern.length }
          if (e.shiftKey) {
            const sel = selectionRef.current
            setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track })
          } else if (!e.shiftKey) {
            setSelection(null)
          }
          return next
        })
        return
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault()
        setVolumeEntry(null); volumeEntryRef.current = null
        setCursor((c) => {
          const next = { ...c, row: (c.row - 1 + pattern.length) % pattern.length }
          if (e.shiftKey) {
            const sel = selectionRef.current
            setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track })
          } else if (!e.shiftKey) {
            setSelection(null)
          }
          return next
        })
        return
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        setVolumeEntry(null); volumeEntryRef.current = null
        if (!ids.length) return
        setCursor((c) => {
          const next = c.col === 0
            ? { ...c, col: 1 as const }
            : { ...c, col: 0 as const, track: (c.track + 1) % ids.length }
          if (e.shiftKey) {
            const sel = selectionRef.current
            setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track })
          } else if (!e.shiftKey) {
            setSelection(null)
          }
          return next
        })
        return
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setVolumeEntry(null); volumeEntryRef.current = null
        if (!ids.length) return
        setCursor((c) => {
          const next = c.col === 1
            ? { ...c, col: 0 as const }
            : { ...c, col: 1 as const, track: (c.track - 1 + ids.length) % ids.length }
          if (e.shiftKey) {
            const sel = selectionRef.current
            setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track })
          } else if (!e.shiftKey) {
            setSelection(null)
          }
          return next
        })
        return
      }

      // Octave shift ( - / = ), kept off the note map so [ ] stay as notes.
      if (e.code === 'Minus') { e.preventDefault(); setOctave((o) => Math.max(0, o - 1)); return }
      if (e.code === 'Equal') { e.preventDefault(); setOctave((o) => Math.min(9, o + 1)); return }

      // Clear cell (or selection).
      if (e.code === 'Delete') {
        e.preventDefault()
        const sel = selectionRef.current
        if (sel) {
          // Clear all cells in selection.
          const r0 = Math.min(sel.startRow, sel.endRow)
          const r1 = Math.max(sel.startRow, sel.endRow)
          const t0 = Math.min(sel.startTrack, sel.endTrack)
          const t1 = Math.max(sel.startTrack, sel.endTrack)
          for (let ti = t0; ti <= t1; ti++) {
            const tid = ids[ti]
            if (!tid) continue
            for (let r = r0; r <= r1; r++) {
              setCellNote(tid, r, null)
              setCellVolume(tid, r, null)
            }
          }
          setSelection(null)
        } else if (trackId) {
          if (cur.col === 1) {
            // In volume column: clear volume, advance cursor.
            setCellVolume(trackId, cur.row, null)
            setVolumeEntry(null)
            volumeEntryRef.current = null
            setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          } else {
            setCellNote(trackId, cur.row, null)
            setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          }
        }
        return
      }

      // Volume column entry: hex digits type directly into the volume field.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && cur.col === 1) {
        const hex = keyToHex(e.code)
        if (hex !== undefined && trackId) {
          e.preventDefault()
          setSelection(null)
          const pending = volumeEntryRef.current
          if (pending !== null) {
            // Second hex digit: combine and advance.
            const vol = (pending * 16 + hex) / 255
            setCellVolume(trackId, cur.row, vol)
            setVolumeEntry(null)
            volumeEntryRef.current = null
            setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          } else {
            // First hex digit: set high nibble, stay on this cell.
            const vol = (hex * 16) / 255
            setCellVolume(trackId, cur.row, vol)
            setVolumeEntry(hex)
            volumeEntryRef.current = hex
          }
          return
        }
        return // any other key in volume column: don't fall through to note entry
      }

      // Note-off entry: backtick key inserts note-off at cursor.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backquote') {
        e.preventDefault()
        setSelection(null)
        if (trackId) {
          const cell = useDocStore.getState().doc.entities.tracks[trackId]?.cells[cur.row]
          // Toggle: if already note-off, clear it; otherwise set note-off.
          setCellNoteOff(trackId, cur.row, !cell?.noteOff)
          setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        }
        return
      }

      // Volume adjust: [ / ] step volume down/up on the current cell.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        e.preventDefault()
        setSelection(null)
        if (trackId) {
          const cell = useDocStore.getState().doc.entities.tracks[trackId]?.cells[cur.row]
          const curVol = cell?.volume ?? 1
          const step = 1 / 16
          const newVol = e.code === 'BracketLeft'
            ? Math.max(0, curVol - step)
            : Math.min(1, curVol + step)
          setCellVolume(trackId, cur.row, newVol)
        }
        return
      }

      // Note entry (no modifiers).
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const semi = codeToSemitone(e.code)
        if (semi !== undefined && trackId) {
          e.preventDefault()
          setSelection(null)
          setCellNote(trackId, cur.row, octaveRef.current * 12 + semi)
          setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        }
      }
    },
    [view, pattern, host, toggle, undo, redo, setCellNote, setCellNoteOff, setCellVolume, addTrack, removeTrack, moveTrack, copyTrack, pasteTrack, duplicateTrack, shiftTrack, toggleMute, copyRect, cutRect, pasteRect],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <div className="app">
      <header className="toolbar">
        <strong>synthor</strong>
        <span className="muted" title="Loaded song">{projectName}</span>
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
      <SongBar doc={doc} />
      {view === 'tracker' ? (
        <div className="layout">
          <main className="main">
            <TrackerGrid doc={doc} pattern={pattern} cursor={cursor} playhead={playhead} muted={mutedTracks} selection={selection} volumeEntry={volumeEntry} onCellClick={onCellClick} />
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

/** Map a KeyboardEvent code to a hex digit (0-15), or undefined if not a hex key. */
function keyToHex(code: string): number | undefined {
  if (code >= 'Digit0' && code <= 'Digit9') return code.charCodeAt(5) - 48 // '0' = 48
  if (code >= 'KeyA' && code <= 'KeyF') return code.charCodeAt(3) - 65 + 10 // 'A' = 65
  return undefined
}
