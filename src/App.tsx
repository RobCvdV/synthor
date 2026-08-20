import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from './state/docStore'
import { rowHz, useTransportStore } from './state/transportStore'
import { useAppStore, clampCursor, type TrackerCursor } from './state/appStore'
import { useEngine } from './ui/useEngine'
import { useAutosave } from './ui/useAutosave'
import { codeToSemitone, isEditableTarget, keyToHex } from './ui/keymap'
import { Dialog } from './ui/Dialog'
import { Toolbar } from './ui/Toolbar'
import { TrackerGrid, type Selection } from './ui/TrackerGrid'
import { TrackerRightPane } from './ui/TrackerRightPane'
import { InstrumentsView } from './ui/InstrumentsView'
import { SampleLibraryView } from './ui/SampleLibraryView'
import { MixerView } from './ui/MixerView'
import { loadRecent, readSong } from './persist/opfsStore'
import { useProjectStore } from './state/projectStore'
import { createDefaultDoc } from './domain/factory'
import { midiToName } from './domain/notes'
import { useMidi } from './midi/useMidi'
import { useMidiStore } from './state/midiStore'
import { usePreviewStore } from './state/previewStore'
import { KeyboardPlayer } from './audio/keyboardPlayer'
import { installWarmup } from './audio/warmup'
import { useAudioStore } from './state/audioStore'

export default function App() {
  const host = useEngine()
  useAutosave()
  useMidi(host) // connect to Web MIDI API
  const keyboardPlayer = useMemo(() => new KeyboardPlayer(host), [host])

  // Start the audio host on the first user interaction so the first play
  // press finds a warm, silent graph instead of a cold compile.
  useEffect(() => installWarmup(host), [host])

  // Don't render the default placeholder doc — wait until either a persisted
  // song is loaded or a fresh default is created, then apply the rest of the
  // persisted app state (cursor, instrument, view) against the real document.
  const [ready, setReady] = useState(false)
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const slug = await loadRecent()
        if (slug) {
          const file = await readSong(slug)
          if (file) {
            let doc = file.doc
            if (!doc.entities.patterns[doc.patternId]) {
              const firstPat = Object.keys(doc.entities.patterns)[0]
              if (firstPat) doc = { ...doc, patternId: firstPat }
            }
            useProjectStore.getState().reset(file.meta.name, file.meta.createdAt, slug)
            useDocStore.getState().loadDoc(doc)
          }
        }
        // If no persisted song was found, the store's built-in default doc is
        // already in place; reset project identity so it starts clean but
        // named "Untitled".
        if (!slug) {
          useProjectStore.getState().reset('Untitled', new Date().toISOString())
        }
      } catch (err) {
        console.error('Failed to load recent song:', err)
      } finally {
        // Validate persisted app state against the now-loaded document.
        const state = useAppStore.getState()
        const doc = useDocStore.getState().doc
        const pat = doc.entities.patterns[doc.patternId]
        if (pat) {
          state.setTrackerCursor(clampCursor(state.trackerCursor, pat, doc))
        }
        if (!state.selectedInstrumentId || !doc.entities.instruments[state.selectedInstrumentId]) {
          state.setSelectedInstrumentId(Object.keys(doc.entities.instruments)[0] ?? null)
        }
        setReady(true)
      }
    })()
  }, [])

  const doc = useDocStore((s) => s.doc)
  const instruments = Object.values(doc.entities.instruments)
  const setCellNote = useDocStore((s) => s.setCellNote)
  const setCellHold = useDocStore((s) => s.setCellHold)
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
  const copyRect = useDocStore((s) => s.copyRect)
  const cutRect = useDocStore((s) => s.cutRect)
  const pasteRect = useDocStore((s) => s.pasteRect)

  const projectName = useProjectStore((s) => s.name)
  const slug = useProjectStore((s) => s.slug)
  const setProjectName = useProjectStore((s) => s.setName)
  const resetProject = useProjectStore((s) => s.reset)
  const playing = useTransportStore((s) => s.playing)
  const audioStatus = useAudioStore((s) => s.status)
  const playbackStarted = useAudioStore((s) => s.playbackStarted)
  const bpm = useTransportStore((s) => s.bpm)
  const linesPerBeat = useTransportStore((s) => s.linesPerBeat)
  const setBpm = useTransportStore((s) => s.setBpm)
  const toggle = useTransportStore((s) => s.toggle)
  const playMode = useAppStore((s) => s.playMode)
  const setPlayMode = useAppStore((s) => s.setPlayMode)
  const cyclePlayMode = useAppStore((s) => s.cyclePlayMode)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const trackerCursor = useAppStore((s) => s.trackerCursor)
  const selectedInstrumentId = useAppStore((s) => s.selectedInstrumentId)
  const octave = useAppStore((s) => s.octave)
  const setOctave = useAppStore((s) => s.setOctave)
  const toggleMute = useAppStore((s) => s.toggleMute)
  const toggleSolo = useAppStore((s) => s.toggleSolo)
  const mutedTrackNumbers = useAppStore((s) => s.mutedTrackNumbers)
  const soloedTrackNumbers = useAppStore((s) => s.soloedTrackNumbers)

  // Song title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [renameDialog, setRenameDialog] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Tempo editing
  const [editingTempo, setEditingTempo] = useState(false)
  const [tempoDraft, setTempoDraft] = useState('')
  const tempoInputRef = useRef<HTMLInputElement>(null)

  // Tap tempo
  const tapTimesRef = useRef<number[]>([])
  const [tapFlash, setTapFlash] = useState(false)
  const onTapBpm = useCallback(() => {
    const now = performance.now()
    const times = tapTimesRef.current
    if (times.length > 0 && now - times[times.length - 1] > 2000) times.length = 0
    times.push(now)
    if (times.length > 8) times.shift()
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

  // Song title editing
  const beginEditTitle = useCallback(() => {
    setTitleDraft(projectName)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 0)
  }, [projectName])

  const commitTitle = useCallback(() => {
    setEditingTitle(false)
    if (titleDraft && titleDraft !== projectName) {
      setRenameDialog(true)
    }
  }, [titleDraft, projectName])

  const doRenameSong = useCallback(() => {
    setProjectName(titleDraft)
    setRenameDialog(false)
  }, [titleDraft, setProjectName])

  const doNewSong = useCallback(() => {
    if (useProjectStore.getState().status === 'dirty' && !confirm('Discard unsaved changes and create a new song?')) return
    const newDoc = createDefaultDoc()
    useDocStore.getState().loadDoc(newDoc)
    resetProject(titleDraft, new Date().toISOString())
    setRenameDialog(false)
  }, [titleDraft, resetProject])

  const cancelRename = useCallback(() => {
    setRenameDialog(false)
  }, [])

  // Tempo editing
  const beginEditTempo = useCallback(() => {
    setTempoDraft(String(bpm))
    setEditingTempo(true)
    setTimeout(() => tempoInputRef.current?.select(), 0)
  }, [bpm])

  const commitTempo = useCallback(() => {
    setEditingTempo(false)
    const n = Number(tempoDraft)
    if (!isNaN(n) && n >= 20 && n <= 300) setBpm(n)
  }, [tempoDraft, setBpm])

  const pattern = doc.entities.patterns[doc.patternId]
  // Thin wrapper so existing setCursor(fn) call sites keep working with appStore.
  const setCursor = (fn: TrackerCursor | ((c: TrackerCursor) => TrackerCursor)) => {
    useAppStore.setState((s) => ({
      trackerCursor: typeof fn === 'function' ? fn(s.trackerCursor) : fn,
    }))
  }
  const cursor = trackerCursor

  const [selection, setSelection] = useState<Selection | null>(null)
  const [playhead, setPlayhead] = useState<number | null>(null)

  // Compute keyboard note range for the octave display
  const noteRange = `${midiToName(octave * 12)} … ${midiToName(octave * 12 + 30)}`

  // Compute the flattened arrangement for the current play mode.
  // For section/song mode, returns an ordered list of patterns to play through.
  const arrangement = useMemo(() => {
    if (playMode === 'pattern') {
      return [{ patternId: doc.patternId, startRow: 0 }]
    }
    if (playMode === 'section') {
      const secId = doc.sectionIds.find((sid) => {
        const sec = doc.entities.sections[sid]
        return sec?.patternIds.includes(doc.patternId)
      })
      const section = secId ? doc.entities.sections[secId] : null
      const patIds = section?.patternIds ?? [doc.patternId]
      let offset = 0
      return patIds.map((pid) => {
        const p = doc.entities.patterns[pid]
        const row = offset
        offset += p?.length ?? 64
        return { patternId: pid, startRow: row }
      })
    }
    const items: { patternId: string; startRow: number }[] = []
    let offset = 0
    for (const sid of doc.sectionIds) {
      const sec = doc.entities.sections[sid]
      if (!sec) continue
      for (const pid of sec.patternIds) {
        const p = doc.entities.patterns[pid]
        items.push({ patternId: pid, startRow: offset })
        offset += p?.length ?? 64
      }
    }
    return items.length > 0 ? items : [{ patternId: doc.patternId, startRow: 0 }]
  }, [playMode, doc.patternId, doc.sectionIds, doc.entities.sections, doc.entities.patterns])

  const totalArrangementRows = useMemo(() => {
    if (playMode === 'pattern') return pattern.length
    return arrangement.reduce((sum: number, a) =>
      sum + (doc.entities.patterns[a.patternId]?.length ?? 64), 0)
  }, [playMode, pattern.length, arrangement, doc.entities.patterns])

  const cursorRef = useRef(trackerCursor)
  cursorRef.current = trackerCursor
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
  // When the pattern changes (song load, pattern switch), clamp the cursor
  // so it never points past the end of a track or effect lane. Gated on
  // `ready` so validation never runs against the store's factory default.
  useEffect(() => {
    if (!ready) return
    setCursor((c) => {
      const state = useDocStore.getState()
      const pat = state.doc.entities.patterns[state.doc.patternId]
      return clampCursor(c, pat, state.doc)
    })
  }, [trackCount, ready])

  // Auto-select the global keyboard instrument from the cursor's current
  // track so note keys (and MIDI) always play the instrument you're editing.
  // Re-evaluates on cursor moves and pattern switches (section/song playback).
  // Empty tracks keep the last selection.
  useEffect(() => {
    const state = useDocStore.getState()
    const pattern = state.doc.entities.patterns[state.doc.patternId]
    const trackId = pattern?.trackIds[trackerCursor.track]
    const instId = trackId ? state.doc.entities.tracks[trackId]?.instrumentId : null
    useMidiStore.getState().setActiveInstrument(instId ?? null)
    if (instId) useAppStore.getState().setSelectedInstrumentId(instId)
  }, [trackerCursor.track, trackCount, ready])

  // Visual playhead with pattern transition support for section/song modes.
  useEffect(() => {
    // Hold until the scheduler clock actually starts — otherwise the playhead
    // runs ahead during warm-up and snaps back when audio begins.
    if (!playing || !playbackStarted) {
      setPlayhead(null)
      return
    }
    let raf = 0
    let lastPatternId = doc.patternId
    const tick = () => {
      const elapsed = host.currentTime - host.playStartTime
      const rowsPerSec = rowHz(bpm, linesPerBeat)
      const globalRow = host.playStartRow + Math.floor(elapsed * rowsPerSec)

      if (playMode === 'pattern') {
        setPlayhead(globalRow % pattern.length)
      } else {
        // Section / song mode: map global row to arrangement position.
        const totalRows = Math.max(1, totalArrangementRows)
        const wrapped = ((globalRow % totalRows) + totalRows) % totalRows
        // Find which pattern in the arrangement this row falls in.
        const item = arrangement.find(
          (a) => wrapped >= a.startRow && wrapped < a.startRow + (doc.entities.patterns[a.patternId]?.length ?? 64),
        )
        if (item) {
          const localRow = wrapped - item.startRow
          setPlayhead(localRow)
          // Auto-switch the compiled pattern when crossing boundaries.
          if (item.patternId !== lastPatternId) {
            lastPatternId = item.patternId
            // In section/song mode the audio graph spans the full arrangement,
            // so this patternId change is purely for UI.  Suppress the recompile
            // that the doc-store subscription would otherwise trigger.
            if (playMode !== 'pattern' as typeof playMode) host.skipNextRecompile = true
            // Update doc's current pattern without creating an undo entry
            // by using the store setter directly.
            useDocStore.setState((s) => ({
              doc: { ...s.doc, patternId: item.patternId },
            }))
          }
        } else {
          setPlayhead(wrapped)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, playbackStarted, bpm, linesPerBeat, pattern.length, host, playMode, totalArrangementRows, arrangement, doc.entities.patterns, doc.patternId])

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
        // start() is idempotent; useEngine defers the actual scheduler start
        // until the graph is live (play from cursor).
        void host.start()
        toggle(host.currentTime, cursorRef.current.row)
        return
      }

      // --- Transport: Ctrl+Space (play from top) ---
      if (e.code === 'Space' && e.ctrlKey && !e.metaKey && !isEditableTarget(e.target)) {
        e.preventDefault()
        void host.start()
        toggle(host.currentTime, 0)
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
        keyboardPlayer.clearHeld()
        host.panic()
        useAudioStore.getState().setPlaybackStarted(false)
        return
      }

      // --- Mute / Solo toggle: F1..F12 (by Track #) ---
      const fkey = /^F([1-9]|1[0-2])$/.exec(e.code)
      if (fkey) {
        e.preventDefault()
        const trackNum = Number(fkey[1])
        if (pattern.trackIds[trackNum - 1]) {
          if (e.shiftKey) toggleSolo(trackNum)
          else toggleMute(trackNum)
        }
        return
      }

      if (isEditableTarget(e.target)) return

      // --- Tab: cycle play mode ---
      if (e.code === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        cyclePlayMode()
        return
      }

      // --- Mod+T/I/S: switch views ---
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.code === 'KeyT') { e.preventDefault(); setView('tracker'); return }
        if (e.code === 'KeyI') { e.preventDefault(); setView('instruments'); return }
        if (e.code === 'KeyS') { e.preventDefault(); setView('samples'); return }
        if (e.code === 'KeyM') { e.preventDefault(); setView('mixer'); return }
      }

      const cur = cursorRef.current
      const ids = pattern.trackIds
      const trackId = ids[cur.track]
      const stepRows = (n: number) => (c: TrackerCursor) => {
        const next = { ...c, row: ((c.row + n) % pattern.length + pattern.length) % pattern.length }
        if (e.shiftKey) {
          const sel = selectionRef.current
          setSelection(sel ? { ...sel, endRow: next.row, endTrack: next.track } : { startRow: c.row, startTrack: c.track, endRow: next.row, endTrack: next.track })
        } else {
          setSelection(null)
        }
        return next
      }

      const snapStep = (step: number, dir: 1 | -1) => (c: TrackerCursor) => {
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

      // --- Octave shift ( - / = ) — global across all views ---
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code === 'Minus') { e.preventDefault(); setOctave(octaveRef.current - 1); return }
        if (e.code === 'Equal') { e.preventDefault(); setOctave(octaveRef.current + 1); return }
      }

      if (view !== 'tracker') {
        // Note keys play the global instrument on the mixer — held until
        // key-up (see onKeyUp), no cell writes.
        if (view === 'mixer' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const semi = codeToSemitone(e.code)
          if (semi !== undefined) {
            e.preventDefault()
            if (e.repeat) return // one attack per physical press
            const instId = useAppStore.getState().selectedInstrumentId
            if (instId) {
              const note = octaveRef.current * 12 + semi
              void host.start().then(() => keyboardPlayer.noteOn(instId, note, e.code))
            }
          }
        }
        return
      }

      // --- Cmd/Meta shortcuts ---
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.code) {
          case 'KeyC': e.preventDefault(); { const s = selectionRef.current; if (s) copyRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); else if (trackId) copyTrack(trackId) } return
          case 'KeyV': e.preventDefault(); { const rc = useDocStore.getState().rectClipboard; if (rc) { const s = selectionRef.current; const pr = s ? s.startRow : cur.row; const pt = s ? s.startTrack : cur.track; pasteRect(ids, pr, pt) } else { pasteTrack(cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } } return
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
          case 'KeyV': e.preventDefault(); { const rc = useDocStore.getState().rectClipboard; if (rc) { const s = selectionRef.current; const pr = s ? s.startRow : cur.row; const pt = s ? s.startTrack : cur.track; pasteRect(ids, pr, pt) } else { pasteTrack(cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } } return
          case 'KeyX': e.preventDefault(); { const s = selectionRef.current; if (s) { cutRect(ids, s.startRow, s.endRow, s.startTrack, s.endTrack); setSelection(null) } else if (trackId) { copyTrack(trackId); removeTrack(trackId); setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) })) } } return
          case 'KeyD': e.preventDefault(); if (trackId) { duplicateTrack(trackId, cur.track + 1); setCursor((c) => ({ ...c, track: Math.min(liveTrackCount() - 1, cur.track + 1) })) } return
          case 'Backspace': e.preventDefault(); if (trackId) { removeTrack(trackId); setCursor((c) => ({ ...c, track: Math.max(0, Math.min(c.track, liveTrackCount() - 1)) })) } return
          case 'ArrowUp':   e.preventDefault(); if (trackId) shiftTrack(trackId, 'up'); return
          case 'ArrowDown': e.preventDefault(); if (trackId) shiftTrack(trackId, 'down'); return
          case 'Equal': {
            e.preventDefault()
            const inheritId = useDocStore.getState().doc.entities.tracks[trackId]?.instrumentId ?? Object.keys(useDocStore.getState().doc.entities.instruments)[0] ?? useDocStore.getState().addInstrument('modular')
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
          let next: TrackerCursor
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
          let next: TrackerCursor
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

      // --- Hold (backslash, displayed as '|') ---
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backslash') {
        e.preventDefault(); setSelection(null)
        if (trackId) { const cell = useDocStore.getState().doc.entities.tracks[trackId]?.cells[cur.row]; setCellHold(trackId, cur.row, !cell?.hold); setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length })) }
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
          // Preview-pip the note through VoicePool regardless of transport
          // state so you can hear what you're entering mid-playback.
          {
            const instId = useAppStore.getState().selectedInstrumentId
            if (instId) {
              void host.start().then(() => {
                keyboardPlayer.noteOn(instId, note)
                setTimeout(() => keyboardPlayer.noteOffNote(instId, note), 120)
              })
            }
          }
          setCursor((c) => ({ ...c, row: (c.row + 1) % pattern.length }))
        }
      }
    },
    [view, pattern, host, toggle, undo, redo, setCellNote, setCellHold, setCellVolume, setCellEffectLane, addEffectLane, removeEffectLane, addTrack, removeTrack, moveTrack, copyTrack, pasteTrack, duplicateTrack, shiftTrack, toggleMute, copyRect, cutRect, pasteRect, clearEntry, laneCountForTrack, cyclePlayMode],
  )

  const onKeyUp = useCallback(
    (e: KeyboardEvent) => {
      const released = keyboardPlayer.noteOff(e.code)
      if (released) usePreviewStore.getState().noteOff(released.note)
    },
    [keyboardPlayer],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  useEffect(() => {
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [onKeyUp])

  return (
    <div className="app">
      <Toolbar
        playing={playing}
        audioStatus={audioStatus}
        playbackStarted={playbackStarted}
        onTogglePlay={() => {
          void host.start()
          toggle(host.currentTime, cursorRef.current.row)
        }}
        playMode={playMode}
        onSetPlayMode={setPlayMode}
        editingTitle={editingTitle}
        titleDraft={titleDraft}
        projectName={projectName}
        titleInputRef={titleInputRef}
        onTitleDraftChange={setTitleDraft}
        onCommitTitle={commitTitle}
        onCancelTitleEdit={() => { setEditingTitle(false); setTitleDraft(projectName) }}
        onBeginEditTitle={beginEditTitle}
        editingTempo={editingTempo}
        tempoDraft={tempoDraft}
        bpm={bpm}
        tapFlash={tapFlash}
        tempoInputRef={tempoInputRef}
        onTempoDraftChange={setTempoDraft}
        onCommitTempo={commitTempo}
        onCancelTempoEdit={() => setEditingTempo(false)}
        onBeginEditTempo={beginEditTempo}
        onTapBpm={onTapBpm}
        instruments={instruments}
        selectedInstrumentId={selectedInstrumentId}
        onSelectInstrument={(id) => {
          useAppStore.getState().setSelectedInstrumentId(id)
          useMidiStore.getState().setActiveInstrument(id)
        }}
        noteRange={noteRange}
        onOctaveDown={() => setOctave(octaveRef.current - 1)}
        onOctaveUp={() => setOctave(octaveRef.current + 1)}
        onPanic={() => {
          keyboardPlayer.clearHeld()
          host.panic()
          host.stopSamplePreviews()
          usePreviewStore.getState().panic()
          useAudioStore.getState().setPlaybackStarted(false)
        }}
        view={view}
        onSetView={setView}
      />

      {/* Rename dialog */}
      {renameDialog && (
        <Dialog
          onClose={cancelRename}
          actions={
            <>
              <button className="octbtn" onClick={doNewSong}>Create New Song</button>
              <button className="octbtn" onClick={doRenameSong}>Rename Current</button>
              <button className="octbtn" onClick={cancelRename}>Cancel</button>
            </>
          }
        >
          <p>
            "<strong>{titleDraft}</strong>" is not the current song name.
          </p>
        </Dialog>
      )}

      {ready && (view === 'tracker' ? (
        <div className="layout">
          <main className="main">
            <TrackerGrid
              doc={doc}
              pattern={pattern}
              cursor={cursor}
              playhead={playhead}
              muted={mutedTrackNumbers}
              soloed={soloedTrackNumbers}
              selection={selection}
              volumeEntry={volumeEntry}
              laneEntry={laneEntry}
              onCellClick={onCellClick}
            />
          </main>
          <TrackerRightPane doc={doc} slug={slug} />
        </div>
      ) : view === 'instruments' ? (
        <div className="layout">
          <InstrumentsView host={host} keyboardPlayer={keyboardPlayer} />
        </div>
      ) : view === 'mixer' ? (
        <div className="layout">
          <MixerView />
        </div>
      ) : (
        <div className="layout">
          <SampleLibraryView host={host} />
        </div>
      ))}
    </div>
  )
}

