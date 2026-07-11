import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from './state/docStore'
import { rowHz, useTransportStore } from './state/transportStore'
import { useEngine } from './ui/useEngine'
import { codeToSemitone } from './ui/keymap'
import { TrackerGrid, type Cursor } from './ui/TrackerGrid'
import { Legend } from './ui/Legend'

export default function App() {
  const host = useEngine()

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

  const playing = useTransportStore((s) => s.playing)
  const bpm = useTransportStore((s) => s.bpm)
  const linesPerBeat = useTransportStore((s) => s.linesPerBeat)
  const toggle = useTransportStore((s) => s.toggle)

  const pattern = doc.entities.patterns[doc.patternId]
  const [cursor, setCursor] = useState<Cursor>({ row: 0, track: 0 })
  const [octave, setOctave] = useState(5)
  const [playhead, setPlayhead] = useState<number | null>(null)

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

      // Track operations — all on Ctrl (per design). Ctrl swallows note entry.
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.code) {
          case 'Comma': // Ctrl+,  move left  / Ctrl+Shift+,  insert left
            e.preventDefault()
            if (e.shiftKey) {
              addTrack(cur.track)
              setCursor((c) => ({ ...c, track: cur.track }))
            } else {
              moveTrack(cur.track, cur.track - 1)
              setCursor((c) => ({ ...c, track: Math.max(0, cur.track - 1) }))
            }
            return
          case 'Period': // Ctrl+.  move right / Ctrl+Shift+.  insert right
            e.preventDefault()
            if (e.shiftKey) {
              addTrack(cur.track + 1)
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
          case 'Backspace':
            e.preventDefault()
            if (trackId) {
              copyTrack(trackId) // "cut" = copy then remove
              removeTrack(trackId)
              setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) }))
            }
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
    [pattern, host, toggle, undo, redo, setCellNote, addTrack, removeTrack, moveTrack, copyTrack, pasteTrack, duplicateTrack],
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
        <button className="octbtn" onClick={() => setOctave((o) => Math.max(0, o - 1))}>oct −</button>
        <button className="octbtn" onClick={() => setOctave((o) => Math.min(9, o + 1))}>oct +</button>
      </header>
      <div className="layout">
        <main className="main">
          <TrackerGrid doc={doc} pattern={pattern} cursor={cursor} playhead={playhead} />
        </main>
        <Legend />
      </div>
    </div>
  )
}
