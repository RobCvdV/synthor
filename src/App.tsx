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
import { SampleLibraryView } from './ui/SampleLibraryView'
import { loadRecent, readSong } from './persist/opfsStore'
import { useProjectStore } from './state/projectStore'
import { useMidiStore } from './state/midiStore'
import { useMidi } from './midi/useMidi'
import { packEffect } from './domain/effects'

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
  useMidi(host) // connect to Web MIDI API

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
        let doc = file.doc
        if (!doc.entities.patterns[doc.patternId]) {
          const firstPat = Object.keys(doc.entities.patterns)[0]
          if (firstPat) doc = { ...doc, patternId: firstPat }
        }
        useProjectStore.getState().reset(file.meta.name, file.meta.createdAt, slug)
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
  const setCellEffect = useDocStore((s) => s.setCellEffect)
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
  const toggleSolo = useDocStore((s) => s.toggleSolo)
  const soloedTracks = useDocStore((s) => s.soloedTracks)
  const copyRect = useDocStore((s) => s.copyRect)
  const cutRect = useDocStore((s) => s.cutRect)
  const pasteRect = useDocStore((s) => s.pasteRect)
  const mutedTracks = useDocStore((s) => s.mutedTracks)

  // MIDI
  const midiConnected = useMidiStore((s) => s.connected)
  const midiInputs = useMidiStore((s) => s.inputs)
  const midiSelectedId = useMidiStore((s) => s.selectedInputId)
  const midiActiveInst = useMidiStore((s) => s.activeInstrumentId)
  const setMidiActiveInst = useMidiStore((s) => s.setActiveInstrument)

  const projectName = useProjectStore((s) => s.name)
  const playing = useTransportStore((s) => s.playing)
  const bpm = useTransportStore((s) => s.bpm)
  const linesPerBeat = useTransportStore((s) => s.linesPerBeat)
  const setBpm = useTransportStore((s) => s.setBpm)
  const toggle = useTransportStore((s) => s.toggle)

  // Tap tempo: average last N taps to set BPM.
  const tapTimesRef = useRef<number[]>([])
  const [tapFlash, setTapFlash] = useState(false)
  const onTapBpm = useCallback(() => {
    const now = performance.now()
    const times = tapTimesRef.current
    // Reset if last tap was >2s ago.
    if (times.length > 0 && now - times[times.length - 1] > 2000) times.length = 0
    times.push(now)
    // Keep only last 8 taps.
    if (times.length > 8) times.shift()
    // Need at least 2 taps for a tempo estimate.
    if (times.length >= 2) {
      let totalInterval = 0
      for (let i = 1; i < times.length; i++) totalInterval += times[i] - times[i - 1]
      const avgInterval = totalInterval / (times.length - 1)
      const newBpm = Math.round(60000 / avgInterval)
      setBpm(Math.max(20, Math.min(300, newBpm)))
    }
    setTapFlash(true)
    setTimeout(() => setTapFlash(false), 150)
  }, [setBpm])

  const pattern = doc.entities.patterns[doc.patternId]
  const [cursor, setCursor] = useState<Cursor>({ row: 0, track: 0, col: 0 as const })
  // Effect entry: pending type nibble (0-15) and operand nibbles.
  const effectEntryRef = useRef<{ type: number; opHi: number | null } | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [octave, setOctave] = useState(5)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [view, setView] = useState<'tracker' | 'instruments' | 'samples'>('tracker')

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const octaveRef = useRef(octave)
  octaveRef.current = octave
  const volumeEntryRef = useRef<number | null>(null)
  const [volumeEntry, setVolumeEntry] = useState<number | null>(null)

  const trackCount = pattern.trackIds.length
  useEffect(() => {
    setCursor((c) => (c.track >= trackCount ? { ...c, track: Math.max(0, trackCount - 1) } : c))
  }, [trackCount])

  // Visual playhead: driven by the AudioContext clock, aligned to the
  // precise moment the graph was rendered (host.playStartTime). The
  // host.playStartRow accounts for play-from-cursor position so the visual
  // cursor stays in lockstep with the audio engine regardless of edits,
  // pattern length changes, or graph recompiles.
  useEffect(() => {
    if (!playing) {
      setPlayhead(null)
      return
    }
    let raf = 0
    const tick = () => {
      const elapsed = host.currentTime - host.playStartTime
      setPlayhead((host.playStartRow + Math.floor(elapsed * rowHz(bpm, linesPerBeat))) % pattern.length)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, bpm, linesPerBeat, pattern.length, host])

  const liveTrackCount = () => useDocStore.getState().doc.entities.patterns[doc.patternId].trackIds.length

  const onCellClick = useCallback((row: number, track: number, shiftKey: boolean) => {
    setVolumeEntry(null)
    volumeEntryRef.current = null
    effectEntryRef.current = null
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
      // --- Transport (spacebar) — skip when typing in a text field ---
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !isEditableTarget(e.target)) {
        e.preventDefault()
        void host.start().then(() => {
          host.playStartTime = host.currentTime
          host.playStartRow = cursorRef.current.row
          toggle(host.currentTime, cursorRef.current.row)
        })
        return
      }

      // --- Transport: Ctrl+Space (play from top) — skip when typing ---
      if (e.code === 'Space' && e.ctrlKey && !e.metaKey && !isEditableTarget(e.target)) {
        e.preventDefault()
        void host.start().then(() => {
          host.playStartTime = host.currentTime
          host.playStartRow = 0
          toggle(host.currentTime, 0)
        })
        return
      }

      // --- Undo / redo (Cmd+Z / Ctrl+Z) — always active ---
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }

      // --- Panic (Esc) — always active, kills all hanging notes ---
      if (e.code === 'Escape' && !isEditableTarget(e.target)) {
        e.preventDefault()
        host.panic()
        return
      }

      // --- Mute / Solo toggle: F1..F12, Shift+F1..F12 — always active ---
      const fkey = /^F([1-9]|1[0-2])$/.exec(e.code)
      if (fkey) {
        e.preventDefault()
        const id = pattern.trackIds[Number(fkey[1]) - 1]
        if (id) {
          if (e.shiftKey) toggleSolo(id)
          else toggleMute(id)
        }
        return
      }

      // All remaining shortcuts are blocked when a text field is focused.
      if (isEditableTarget(e.target)) return

      const cur = cursorRef.current
      const ids = pattern.trackIds
      const trackId = ids[cur.track]

      // Helper: move cursor by n rows, updating shift-selection if shift is held.
      const stepRows = (n: number) => (c: Cursor) => {
        const next = { ...c, row: ((c.row + n) % pattern.length + pattern.length) % pattern.length }
        if (e.shiftKey) {
          const sel = selectionRef.current
          setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track })
        } else {
          setSelection(null)
        }
        return next
      }

      // Helper: snap cursor to the next/previous grid line (multiples of `step`)
      // and update shift-selection. Always lands exactly on a grid line,
      // even when pattern length is not a multiple of the step size.
      const snapStep = (step: number, dir: 1 | -1) => (c: Cursor) => {
        const len = pattern.length
        const grids: number[] = []
        for (let i = 0; i < len; i += step) grids.push(i)
        let nextRow: number
        if (dir > 0) {
          const idx = grids.findIndex((g) => g > c.row)
          nextRow = idx !== -1 ? grids[idx] : grids[0]
        } else {
          const rev = [...grids].reverse()
          const idx = rev.findIndex((g) => g < c.row)
          nextRow = idx !== -1 ? rev[idx] : rev[0]
        }
        const next = { ...c, row: nextRow }
        if (e.shiftKey) {
          const sel = selectionRef.current
          setSelection(sel ? { ...sel, endRow: nextRow, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: nextRow, endTrack: next.track })
        } else {
          setSelection(null)
        }
        return next
      }

      // In non-tracker views only tracker-editing shortcuts are inactive.
      if (view !== 'tracker') return

      // --- Cmd/Meta shortcuts (macOS primary) ---
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.code) {
          case 'KeyC': e.preventDefault(); { const s = selectionRef.current; if (s) copyRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); else if (trackId) copyTrack(trackId) } return
          case 'KeyV': e.preventDefault(); { const rc = useDocStore.getState().rectClipboard; if (rc) pasteRect(ids, cur.row, cur.track); else { pasteTrack(cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } } return
          case 'KeyX': e.preventDefault(); { const s = selectionRef.current; if (s) { cutRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); setSelection(null) } else if (trackId) { copyTrack(trackId); removeTrack(trackId); setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) })) } } return
          case 'KeyD': e.preventDefault(); if (trackId) { duplicateTrack(trackId, cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } return
          case 'ArrowUp':   e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor(snapStep(8, -1)); return
          case 'ArrowDown': e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor(snapStep(8, 1)); return
          // Cmd+-/= : shift selected notes or whole track ±1 semitone.
          case 'Minus':
          case 'Equal': {
            e.preventDefault()
            const step = e.code === 'Equal' ? 1 : -1
            const sel = selectionRef.current
            if (sel) {
              const r0 = Math.min(sel.startRow, sel.endRow), r1 = Math.max(sel.startRow, sel.endRow)
              const t0 = Math.min(sel.startTrack, sel.endTrack), t1 = Math.max(sel.startTrack, sel.endTrack)
              for (let ti = t0; ti <= t1; ti++) {
                const tid = ids[ti]; if (!tid) continue
                for (let r = r0; r <= r1; r++) { const cell = useDocStore.getState().doc.entities.tracks[tid]?.cells[r]; if (cell?.note != null) setCellNote(tid, r, cell.note + step) }
              }
            } else if (trackId) {
              for (let r = 0; r < pattern.length; r++) { const cell = useDocStore.getState().doc.entities.tracks[trackId]?.cells[r]; if (cell?.note != null) setCellNote(trackId, r, cell.note + step) }
            }
            return
          }
        }
        return
      }

      // --- Ctrl shortcuts ---
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.code) {
          case 'KeyC': e.preventDefault(); { const s = selectionRef.current; if (s) copyRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); else if (trackId) copyTrack(trackId) } return
          case 'KeyV': e.preventDefault(); { const rc = useDocStore.getState().rectClipboard; if (rc) pasteRect(ids, cur.row, cur.track); else { pasteTrack(cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } } return
          case 'KeyX': e.preventDefault(); { const s = selectionRef.current; if (s) { cutRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); setSelection(null) } else if (trackId) { copyTrack(trackId); removeTrack(trackId); setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) })) } } return
          case 'KeyD': e.preventDefault(); if (trackId) { duplicateTrack(trackId, cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } return
          case 'Backspace': e.preventDefault(); if (trackId) { removeTrack(trackId); setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) })) } return
          case 'ArrowUp':   e.preventDefault(); if (trackId) shiftTrack(trackId, 'up'); return
          case 'ArrowDown': e.preventDefault(); if (trackId) shiftTrack(trackId, 'down'); return
          // Ctrl+= : add track to the right.
          case 'Equal': {
            e.preventDefault()
            const inheritId = useDocStore.getState().doc.entities.tracks[trackId]?.instrumentId ?? Object.keys(useDocStore.getState().doc.entities.instruments)[0] ?? useDocStore.getState().addInstrument('osc')
            addTrack(cur.track + 1, inheritId)
            setCursor((c) => ({ ...c, track: cur.track + 1 }))
            return
          }
          // Ctrl+,/. : move track left/right.
          case 'Comma':  e.preventDefault(); moveTrack(cur.track, cur.track - 1); setCursor((c) => ({ ...c, track: Math.max(0, cur.track - 1) })); return
          case 'Period': e.preventDefault(); moveTrack(cur.track, cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })); return
        }
        return
      }

      // --- Alt/Option shortcuts ---
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        switch (e.code) {
          case 'ArrowUp':   e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor(snapStep(4, -1)); return
          case 'ArrowDown': e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor(snapStep(4, 1)); return
        }
      }

      // --- Home / End ---
      if (e.code === 'Home') { e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor((c) => ({ ...c, row: 0 })); return }
      if (e.code === 'End')  { e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor((c) => ({ ...c, row: pattern.length - 1 })); return }

      // --- Arrow navigation ---
      if (e.code === 'ArrowDown')  { e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor(stepRows(1)); return }
      if (e.code === 'ArrowUp')    { e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor(stepRows(-1)); return }
      if (e.code === 'ArrowRight') {
        e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null
        if (!ids.length) return
        setCursor((c) => {
          let next: Cursor
          if (c.col === 0) next = { ...c, col: 1 as const }
          else if (c.col === 1) next = { ...c, col: 2 as const }
          else next = { ...c, col: 0 as const, track: (c.track + 1) % ids.length }
          if (e.shiftKey) { const sel = selectionRef.current; setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track }) } else setSelection(null)
          return next
        })
        return
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault(); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null
        if (!ids.length) return
        setCursor((c) => {
          let next: Cursor
          if (c.col === 2) next = { ...c, col: 1 as const }
          else if (c.col === 1) next = { ...c, col: 0 as const }
          else next = { ...c, col: 2 as const, track: (c.track - 1 + ids.length) % ids.length }
          if (e.shiftKey) { const sel = selectionRef.current; setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track }) } else setSelection(null)
          return next
        })
        return
      }

      // --- Octave shift ( - / = ) ---
      if (e.code === 'Minus') { e.preventDefault(); setOctave((o) => Math.max(0, o - 1)); return }
      if (e.code === 'Equal') { e.preventDefault(); setOctave((o) => Math.min(9, o + 1)); return }

      // --- Clear cell (Delete / Backspace, no modifiers) ---
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault()
        const sel = selectionRef.current
        if (sel) {
          const r0 = Math.min(sel.startRow, sel.endRow), r1 = Math.max(sel.startRow, sel.endRow)
          const t0 = Math.min(sel.startTrack, sel.endTrack), t1 = Math.max(sel.startTrack, sel.endTrack)
          for (let ti = t0; ti <= t1; ti++) { const tid = ids[ti]; if (!tid) continue; for (let r = r0; r <= r1; r++) { setCellNote(tid, r, null); setCellVolume(tid, r, null); setCellEffect(tid, r, null) } }
          setSelection(null)
        } else if (trackId) {
          if (cur.col === 2) { setCellEffect(trackId, cur.row, null); effectEntryRef.current = null; setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
          else if (cur.col === 1) { setCellVolume(trackId, cur.row, null); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
          else { setCellNote(trackId, cur.row, null); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
        }
        return
      }

      // --- Volume column entry (hex digits) ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && cur.col === 1) {
        const hex = keyToHex(e.code)
        if (hex !== undefined && trackId) {
          e.preventDefault(); setSelection(null)
          const pending = volumeEntryRef.current
          if (pending !== null) { const vol = (pending * 16 + hex) / 255; setCellVolume(trackId, cur.row, vol); setVolumeEntry(null); volumeEntryRef.current = null; effectEntryRef.current = null; setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
          else { const vol = (hex * 16) / 255; setCellVolume(trackId, cur.row, vol); setVolumeEntry(hex); volumeEntryRef.current = hex }
          return
        }
        return
      }

      // --- Effect column entry (3 hex digits: type + operand) ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && cur.col === 2 && trackId) {
        const hex = keyToHex(e.code)
        if (hex !== undefined) {
          e.preventDefault(); setSelection(null)
          const pending = effectEntryRef.current
          if (pending === null) {
            // First digit: effect type (0-F).
            setCellEffect(trackId, cur.row, packEffect(hex, 0))
            effectEntryRef.current = { type: hex, opHi: null }
          } else if (pending.opHi === null) {
            // Second digit: operand high nibble.
            const opHi = hex
            setCellEffect(trackId, cur.row, packEffect(pending.type, opHi << 4))
            effectEntryRef.current = { type: pending.type, opHi }
          } else {
            // Third digit: operand low nibble — effect committed, advance cursor.
            const op = (pending.opHi << 4) | hex
            setCellEffect(trackId, cur.row, packEffect(pending.type, op))
            effectEntryRef.current = null
            setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          }
          return
        }
        return
      }

      // --- Note-off (backtick) ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backquote') {
        e.preventDefault(); setSelection(null)
        if (trackId) { const cell = useDocStore.getState().doc.entities.tracks[trackId]?.cells[cur.row]; setCellNoteOff(trackId, cur.row, !cell?.noteOff); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
        return
      }

      // --- Volume adjust: [ / ] ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        e.preventDefault(); setSelection(null)
        if (trackId) { const cell = useDocStore.getState().doc.entities.tracks[trackId]?.cells[cur.row]; const cv = cell?.volume ?? 1; const step = 1 / 16; setCellVolume(trackId, cur.row, e.code === 'BracketLeft' ? Math.max(0, cv - step) : Math.min(1, cv + step)) }
        return
      }

      // --- Note entry (no modifiers) ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const semi = codeToSemitone(e.code)
        if (semi !== undefined && trackId) {
          e.preventDefault(); setSelection(null)
          const note = octaveRef.current * 12 + semi
          setCellNote(trackId, cur.row, note)
          if (!useTransportStore.getState().playing) {
            const d = useDocStore.getState().doc
            const instId = d.entities.tracks[trackId]?.instrumentId
            if (instId) {
              void host.start().then(() => {
                const inst = d.entities.instruments[instId]
                const kit = inst?.kind === 'drumkit' ? inst : undefined
                const pool = host.voicePool(instId, 8, kit)
                pool.noteOn(note)
                setTimeout(() => pool.noteOff(note), 120)
              })
            }
          }
          setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        }
      }
    },
    [view, pattern, host, toggle, undo, redo, setCellNote, setCellNoteOff, setCellVolume, setCellEffect, addTrack, removeTrack, moveTrack, copyTrack, pasteTrack, duplicateTrack, shiftTrack, toggleMute, copyRect, cutRect, pasteRect],
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
        <span
          className={'muted bpm-tap' + (tapFlash ? ' flash' : '')}
          title="Click to tap tempo"
          onClick={onTapBpm}
        >
          {bpm} BPM · 1/{linesPerBeat * 4}
        </span>
        <span className="muted">oct {octave}</span>
        <span className="muted">{trackCount} tracks</span>
        <button
          className="panic-btn"
          title="Panic — kill all hanging notes (Esc)"
          onClick={() => host.panic()}
        >
          !
        </button>
        <span
          className={'midi-ind' + (midiConnected ? ' on' : '')}
          title={
            midiConnected
              ? `MIDI: ${midiInputs.find((p) => p.id === midiSelectedId)?.name ?? midiInputs[0]?.name ?? 'connected'}`
              : 'MIDI: not connected'
          }
        >
          {midiConnected ? 'MIDI' : 'midi'}
        </span>
        <select
          className="midi-inst-select"
          value={midiActiveInst ?? ''}
          onChange={(e) => setMidiActiveInst(e.target.value || null)}
          title="Instrument for MIDI input"
        >
          <option value="">(none)</option>
          {Object.values(doc.entities.instruments).map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.name}</option>
          ))}
        </select>
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
        <button
          className={'octbtn' + (view === 'samples' ? ' active' : '')}
          onClick={() => setView('samples')}
        >
          Samples
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
            <TrackerGrid doc={doc} pattern={pattern} cursor={cursor} playhead={playhead} muted={mutedTracks} soloed={soloedTracks} selection={selection} volumeEntry={volumeEntry} onCellClick={onCellClick} />
          </main>
          <Legend />
        </div>
      ) : view === 'instruments' ? (
        <div className="layout">
          <InstrumentsView host={host} />
        </div>
      ) : (
        <div className="layout">
          <SampleLibraryView host={host} />
        </div>
      )}
    </div>
  )
}

/** Map a KeyboardEvent code to a hex digit (0-15), or undefined if not a hex key. */
function keyToHex(code: string): number | undefined {
  if (code >= 'Digit0' && code <= 'Digit9') return code.charCodeAt(5) - 48
  if (code >= 'KeyA' && code <= 'KeyF') return code.charCodeAt(3) - 65 + 10
  return undefined
}
