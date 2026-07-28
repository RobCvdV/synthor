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
import { useMidi } from './midi/useMidi'

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
  const setCellEffectLane = useDocStore((s) => s.setCellEffectLane)
  const addEffectLane = useDocStore((s) => s.addEffectLane)
  const removeEffectLane = useDocStore((s) => s.removeEffectLane)
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

  const playing = useTransportStore((s) => s.playing)
  const bpm = useTransportStore((s) => s.bpm)
  const linesPerBeat = useTransportStore((s) => s.linesPerBeat)
  const toggle = useTransportStore((s) => s.toggle)

  const pattern = doc.entities.patterns[doc.patternId]
  const [cursor, setCursor] = useState<Cursor>({ row: 0, track: 0, col: 0, laneIndex: null })

  const [selection, setSelection] = useState<Selection | null>(null)
  const [octave, setOctave] = useState(5)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [view, setView] = useState<'tracker' | 'instruments' | 'samples'>('tracker')
  void setView // referenced by ProjectBar via view state

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const octaveRef = useRef(octave)
  octaveRef.current = octave

  // Volume entry state
  const volumeEntryRef = useRef<number | null>(null)
  const [volumeEntry, setVolumeEntry] = useState<number | null>(null)

  // Lane value entry state (2 hex digits, like volume)
  const laneEntryRef = useRef<number | null>(null)
  const [laneEntry, setLaneEntry] = useState<number | null>(null)

  /** Clear all pending entry state. */
  const clearEntry = useCallback(() => {
    setVolumeEntry(null)
    volumeEntryRef.current = null
    setLaneEntry(null)
    laneEntryRef.current = null
  }, [setVolumeEntry, setLaneEntry])

  const trackCount = pattern.trackIds.length
  useEffect(() => {
    setCursor((c) => (c.track >= trackCount ? { ...c, track: Math.max(0, trackCount - 1), laneIndex: null } : c))
  }, [trackCount])

  // Visual playhead
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

  /** Get the number of effect lane columns for the current track. */
  const laneCountForTrack = useCallback((trackIndex: number): number => {
    const state = useDocStore.getState()
    const pat = state.doc.entities.patterns[state.doc.patternId]
    const tid = pat?.trackIds[trackIndex]
    const track = tid ? state.doc.entities.tracks[tid] : null
    return track?.effectLanes.length ?? 0
  }, [])

  const onCellClick = useCallback((row: number, track: number, shiftKey: boolean) => {
    clearEntry()
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
  }, [clearEntry])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // --- Transport (spacebar) ---
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !isEditableTarget(e.target)) {
        e.preventDefault()
        void host.start().then(() => {
          host.playStartTime = host.currentTime
          host.playStartRow = cursorRef.current.row
          toggle(host.currentTime, cursorRef.current.row)
        })
        return
      }

      // --- Transport: Ctrl+Space (play from top) ---
      if (e.code === 'Space' && e.ctrlKey && !e.metaKey && !isEditableTarget(e.target)) {
        e.preventDefault()
        void host.start().then(() => {
          host.playStartTime = host.currentTime
          host.playStartRow = 0
          toggle(host.currentTime, 0)
        })
        return
      }

      // --- Undo / redo (Cmd+Z / Ctrl+Z) ---
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }

      // --- Panic (Esc) ---
      if (e.code === 'Escape' && !isEditableTarget(e.target)) {
        e.preventDefault()
        host.panic()
        return
      }

      // --- Mute / Solo toggle: F1..F12 ---
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

      if (isEditableTarget(e.target)) return

      const cur = cursorRef.current
      const ids = pattern.trackIds
      const trackId = ids[cur.track]
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

      if (view !== 'tracker') return

      // --- Cmd/Meta shortcuts ---
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.code) {
          case 'KeyC': e.preventDefault(); { const s = selectionRef.current; if (s) copyRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); else if (trackId) copyTrack(trackId) } return
          case 'KeyV': e.preventDefault(); { const rc = useDocStore.getState().rectClipboard; if (rc) pasteRect(ids, cur.row, cur.track); else { pasteTrack(cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } } return
          case 'KeyX': e.preventDefault(); { const s = selectionRef.current; if (s) { cutRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); setSelection(null) } else if (trackId) { copyTrack(trackId); removeTrack(trackId); setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) })) } } return
          case 'KeyD': e.preventDefault(); if (trackId) { duplicateTrack(trackId, cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } return
          case 'ArrowUp':   e.preventDefault(); clearEntry(); setCursor(snapStep(8, -1)); return
          case 'ArrowDown': e.preventDefault(); clearEntry(); setCursor(snapStep(8, 1)); return
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
          case 'Equal': {
            e.preventDefault()
            const inheritId = useDocStore.getState().doc.entities.tracks[trackId]?.instrumentId ?? Object.keys(useDocStore.getState().doc.entities.instruments)[0] ?? useDocStore.getState().addInstrument('osc')
            addTrack(cur.track + 1, inheritId)
            setCursor((c) => ({ ...c, track: cur.track + 1 }))
            return
          }
          case 'Comma':  e.preventDefault(); moveTrack(cur.track, cur.track - 1); setCursor((c) => ({ ...c, track: Math.max(0, cur.track - 1) })); return
          case 'Period': e.preventDefault(); moveTrack(cur.track, cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })); return
          // Ctrl+L: add effect lane
          case 'KeyL': e.preventDefault(); if (trackId) addEffectLane(trackId, 'panning'); return
          // Ctrl+K: remove last effect lane
          case 'KeyK': e.preventDefault(); if (trackId) {
            const track = useDocStore.getState().doc.entities.tracks[trackId]
            if (track && track.effectLanes.length > 0) {
              removeEffectLane(trackId, track.effectLanes[track.effectLanes.length - 1].id)
              setCursor((c) => ({ ...c, col: Math.min(c.col, 1), laneIndex: null }))
            }
          }; return
        }
        return
      }

      // --- Alt/Option shortcuts ---
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        switch (e.code) {
          case 'ArrowUp':   e.preventDefault(); clearEntry(); setCursor(snapStep(4, -1)); return
          case 'ArrowDown': e.preventDefault(); clearEntry(); setCursor(snapStep(4, 1)); return
        }
      }

      // --- Home / End ---
      if (e.code === 'Home') { e.preventDefault(); clearEntry(); setCursor((c) => ({ ...c, row: 0 })); return }
      if (e.code === 'End')  { e.preventDefault(); clearEntry(); setCursor((c) => ({ ...c, row: pattern.length - 1 })); return }

      // --- Arrow navigation ---
      if (e.code === 'ArrowDown')  { e.preventDefault(); clearEntry(); setCursor(stepRows(1)); return }
      if (e.code === 'ArrowUp')    { e.preventDefault(); clearEntry(); setCursor(stepRows(-1)); return }
      if (e.code === 'ArrowRight') {
        e.preventDefault(); clearEntry()
        if (!ids.length) return
        setCursor((c) => {
          let next: Cursor
          const lc = laneCountForTrack(c.track)
          if (c.col === 0) next = { ...c, col: 1, laneIndex: null }
          else if (c.col === 1) next = lc > 0 ? { ...c, col: 2, laneIndex: 0 } : { ...c, col: 0, laneIndex: null, track: (c.track + 1) % ids.length }
          else if (c.col >= 2 && c.laneIndex !== null && c.laneIndex < lc - 1) next = { ...c, col: c.col + 1, laneIndex: c.laneIndex + 1 }
          else next = { ...c, col: 0, laneIndex: null, track: (c.track + 1) % ids.length }
          if (e.shiftKey) { const sel = selectionRef.current; setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track }) } else setSelection(null)
          return next
        })
        return
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault(); clearEntry()
        if (!ids.length) return
        setCursor((c) => {
          let next: Cursor
          if (c.col >= 2 && c.laneIndex !== null && c.laneIndex > 0) next = { ...c, col: c.col - 1, laneIndex: c.laneIndex - 1 }
          else if (c.col >= 2) next = { ...c, col: 1, laneIndex: null }
          else if (c.col === 1) next = { ...c, col: 0, laneIndex: null }
          else {
            const prevTrack = (c.track - 1 + ids.length) % ids.length
            const prevLc = laneCountForTrack(prevTrack)
            next = prevLc > 0
              ? { col: 1 + prevLc, laneIndex: prevLc - 1, row: c.row, track: prevTrack }
              : { col: 1, laneIndex: null, row: c.row, track: prevTrack }
          }
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
          for (let ti = t0; ti <= t1; ti++) {
            const tid = ids[ti]; if (!tid) continue
            const track = useDocStore.getState().doc.entities.tracks[tid]
            for (let r = r0; r <= r1; r++) {
              setCellNote(tid, r, null)
              setCellVolume(tid, r, null)
              for (const lane of (track?.effectLanes ?? [])) setCellEffectLane(tid, r, lane.id, null)
            }
          }
          setSelection(null)
        } else if (trackId) {
          const track = useDocStore.getState().doc.entities.tracks[trackId]
          if (cur.col >= 2 && cur.laneIndex !== null && track) {
            const laneId = track.effectLanes[cur.laneIndex]?.id
            if (laneId) { setCellEffectLane(trackId, cur.row, laneId, null); clearEntry(); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
          } else if (cur.col === 1) {
            setCellVolume(trackId, cur.row, null); clearEntry(); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          } else {
            setCellNote(trackId, cur.row, null); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          }
        }
        return
      }

      // --- Volume column entry (hex digits) ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && cur.col === 1) {
        const hex = keyToHex(e.code)
        if (hex !== undefined && trackId) {
          e.preventDefault(); setSelection(null)
          const pending = volumeEntryRef.current
          if (pending !== null) {
            const vol = (pending * 16 + hex) / 255; setCellVolume(trackId, cur.row, vol); clearEntry(); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          } else {
            const vol = (hex * 16) / 255; setCellVolume(trackId, cur.row, vol); setVolumeEntry(hex); volumeEntryRef.current = hex
          }
          return
        }
        return
      }

      // --- Effect lane value entry (2 hex digits like volume) ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && cur.col >= 2 && cur.laneIndex !== null && trackId) {
        const hex = keyToHex(e.code)
        if (hex !== undefined) {
          e.preventDefault(); setSelection(null)
          const track = useDocStore.getState().doc.entities.tracks[trackId]
          const laneId = track?.effectLanes[cur.laneIndex]?.id
          if (!laneId) return
          const pending = laneEntryRef.current
          if (pending !== null) {
            const val = (pending * 16 + hex) / 255; setCellEffectLane(trackId, cur.row, laneId, val); clearEntry(); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
          } else {
            const val = (hex * 16) / 255; setCellEffectLane(trackId, cur.row, laneId, val); setLaneEntry(hex); laneEntryRef.current = hex
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
    [view, pattern, host, toggle, undo, redo, setCellNote, setCellNoteOff, setCellVolume, setCellEffectLane, addEffectLane, removeEffectLane, addTrack, removeTrack, moveTrack, copyTrack, pasteTrack, duplicateTrack, shiftTrack, toggleMute, copyRect, cutRect, pasteRect, clearEntry, laneCountForTrack],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <div className="app">
      <ProjectBar />
      <SongBar doc={doc} />
      {view === 'tracker' ? (
        <div className="layout">
          <main className="main">
            <TrackerGrid
              doc={doc}
              pattern={pattern}
              cursor={cursor}
              playhead={playhead}
              muted={mutedTracks}
              soloed={soloedTracks}
              selection={selection}
              volumeEntry={volumeEntry}
              laneEntry={laneEntry}
              onCellClick={onCellClick}
            />
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

/** Map a KeyboardEvent code to its hex digit value 0-15, or undefined. */
function keyToHex(code: string): number | undefined {
  if (code === 'Digit0') return 0
  if (code === 'Digit1') return 1
  if (code === 'Digit2') return 2
  if (code === 'Digit3') return 3
  if (code === 'Digit4') return 4
  if (code === 'Digit5') return 5
  if (code === 'Digit6') return 6
  if (code === 'Digit7') return 7
  if (code === 'Digit8') return 8
  if (code === 'Digit9') return 9
  if (code === 'KeyA') return 10
  if (code === 'KeyB') return 11
  if (code === 'KeyC') return 12
  if (code === 'KeyD') return 13
  if (code === 'KeyE') return 14
  if (code === 'KeyF') return 15
  return undefined
}
