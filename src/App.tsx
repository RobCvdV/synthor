import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from './state/docStore'
import { rowHz, useTransportStore } from './state/transportStore'
import { useEngine } from './ui/useEngine'
import { keyToSemitone } from './ui/keymap'
import { TrackerGrid, type Cursor } from './ui/TrackerGrid'

export default function App() {
  const host = useEngine()

  const doc = useDocStore((s) => s.doc)
  const setCellNote = useDocStore((s) => s.setCellNote)
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)

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

  // Visual playhead: derived from the shared AudioContext clock while playing.
  // (A known approximation — will be replaced by an el.snapshot tap later.)
  useEffect(() => {
    if (!playing) {
      setPlayhead(null)
      return
    }
    let raf = 0
    const tick = () => {
      const pos = Math.floor(host.currentTime * rowHz(bpm, linesPerBeat)) % pattern.length
      setPlayhead(pos)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, bpm, linesPerBeat, pattern.length, host])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const cur = cursorRef.current
      const trackId = pattern.trackIds[cur.track]

      // Transport (spacebar) — also the user gesture that boots audio.
      if (e.code === 'Space') {
        e.preventDefault()
        void host.start().then(toggle)
        return
      }
      // Undo / redo.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      // Navigation.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => ({ ...c, row: (c.row - 1 + pattern.length) % pattern.length }))
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCursor((c) => ({ ...c, track: (c.track + 1) % pattern.trackIds.length }))
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCursor((c) => ({ ...c, track: (c.track - 1 + pattern.trackIds.length) % pattern.trackIds.length }))
        return
      }
      // Octave.
      if (e.key === '[') { setOctave((o) => Math.max(0, o - 1)); return }
      if (e.key === ']') { setOctave((o) => Math.min(9, o + 1)); return }
      // Clear cell.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setCellNote(trackId, cur.row, null)
        setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        return
      }
      // Note entry.
      const semi = keyToSemitone(e.key)
      if (semi !== undefined) {
        e.preventDefault()
        setCellNote(trackId, cur.row, octaveRef.current * 12 + semi)
        setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
      }
    },
    [pattern, host, toggle, undo, redo, setCellNote],
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
        <span className="spacer" />
        <span className="muted hint">
          space play · z–m notes · [ ] octave · ⌘Z undo
        </span>
      </header>
      <TrackerGrid doc={doc} pattern={pattern} cursor={cursor} playhead={playhead} />
    </div>
  )
}
