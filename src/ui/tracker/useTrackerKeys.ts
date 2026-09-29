import { useCallback, useRef, useState } from 'react'
import type { AudioHost } from '../../audio/host'
import type { KeyboardPlayer } from '../../audio/keyboardPlayer'
import { trackLiveSlot } from '../../player/liveSlot'
import { useAppStore, type TrackerCursor } from '../../state/appStore'
import { useDocStore } from '../../state/docStore'
import { codeToSemitone, keyToHex } from '../keymap'
import {
  enterHexDigit, extendSelection, moveLeft, moveRight, selectionBounds, snapRow, stepRow, type Selection,
} from './trackerNav'

export interface TrackerKeys {
  selection: Selection | null
  /** First hex digit typed into the volume / lane column, awaiting the second. */
  volumeEntry: number | null
  laneEntry: number | null
  onCellClick: (row: number, track: number, shiftKey: boolean) => void
  /** Tracker editing keys; App's global listener calls it in the tracker view. */
  handleKeyDown: (e: KeyboardEvent) => void
}

const getCursor = () => useAppStore.getState().trackerCursor
const setCursor = (trackerCursor: TrackerCursor) => useAppStore.setState({ trackerCursor })

function laneCount(track: number): number {
  const { doc } = useDocStore.getState()
  const tid = doc.entities.patterns[doc.patternId]?.trackIds[track]
  return (tid && doc.entities.tracks[tid]?.effectLanes.length) || 0
}

function trackCount(): number {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId]?.trackIds.length ?? 0
}

/** Moves the cursor to track `t`, clamped to the pattern's current tracks. */
function focusTrack(t: number): void {
  setCursor({ ...getCursor(), track: Math.max(0, Math.min(t, trackCount() - 1)) })
}

/** Tracker cursor, selection and cell-editing keys. State that changes per keystroke lives in refs,
 *  so `handleKeyDown` stays stable. */
export function useTrackerKeys(host: AudioHost, keyboardPlayer: KeyboardPlayer): TrackerKeys {
  const [selection, setSelectionState] = useState<Selection | null>(null)
  const [volumeEntry, setVolumeEntryState] = useState<number | null>(null)
  const [laneEntry, setLaneEntryState] = useState<number | null>(null)
  const selectionRef = useRef(selection)
  const volumeEntryRef = useRef(volumeEntry)
  const laneEntryRef = useRef(laneEntry)

  const setSelection = useCallback((s: Selection | null) => { selectionRef.current = s; setSelectionState(s) }, [])
  const setVolumeEntry = useCallback((v: number | null) => { volumeEntryRef.current = v; setVolumeEntryState(v) }, [])
  const setLaneEntry = useCallback((v: number | null) => { laneEntryRef.current = v; setLaneEntryState(v) }, [])
  const clearEntry = useCallback(() => { setVolumeEntry(null); setLaneEntry(null) }, [setVolumeEntry, setLaneEntry])

  const onCellClick = useCallback((row: number, track: number, shiftKey: boolean) => {
    clearEntry()
    const cur = getCursor()
    const next = { ...cur, row, track }
    setSelection(shiftKey ? extendSelection(selectionRef.current, cur, next) : null)
    setCursor(next)
  }, [clearEntry, setSelection])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const store = useDocStore.getState()
    const pattern = store.doc.entities.patterns[store.doc.patternId]
    if (!pattern) return
    const len = pattern.length
    const ids = pattern.trackIds
    const cur = getCursor()
    const trackId = ids[cur.track]
    const sel = selectionRef.current
    const noMods = !e.ctrlKey && !e.metaKey && !e.altKey
    const cellAt = (tid: string, row: number) => useDocStore.getState().doc.entities.tracks[tid]?.cells[row]

    /** Cursor moves extend the selection with Shift and drop it otherwise. */
    const moveTo = (next: TrackerCursor) => {
      e.preventDefault()
      clearEntry()
      setSelection(e.shiftKey ? extendSelection(sel, cur, next) : null)
      setCursor(next)
    }
    const advance = () => setCursor(stepRow(getCursor(), 1, len))

    // --- Clipboard and track duplication (Cmd or Ctrl) ---
    if (e.metaKey !== e.ctrlKey && !e.altKey) {
      switch (e.code) {
        case 'KeyC':
          e.preventDefault()
          if (sel) store.copyRect(ids, sel.startRow, sel.endRow, sel.startTrack, sel.endTrack)
          else if (trackId) store.copyTrack(trackId)
          return
        case 'KeyV':
          e.preventDefault()
          if (store.rectClipboard) store.pasteRect(ids, sel ? sel.startRow : cur.row, sel ? sel.startTrack : cur.track)
          else { store.pasteTrack(cur.track + 1); focusTrack(cur.track + 1) }
          return
        case 'KeyX':
          e.preventDefault()
          if (sel) { store.cutRect(ids, sel.startRow, sel.endRow, sel.startTrack, sel.endTrack); setSelection(null) }
          else if (trackId) { store.copyTrack(trackId); store.removeTrack(trackId); focusTrack(cur.track) }
          return
        case 'KeyD':
          e.preventDefault()
          if (trackId) { store.duplicateTrack(trackId, cur.track + 1); focusTrack(cur.track + 1) }
          return
      }
    }

    // --- Cmd: bar jumps, transpose ---
    if (e.metaKey && !e.ctrlKey && !e.altKey) {
      switch (e.code) {
        case 'ArrowUp': moveTo(snapRow(cur, 8, -1, len)); return
        case 'ArrowDown': moveTo(snapRow(cur, 8, 1, len)); return
        case 'Minus':
        case 'Equal': {
          e.preventDefault()
          const step = e.code === 'Equal' ? 1 : -1
          const { r0, r1, t0, t1 } = sel ? selectionBounds(sel) : { r0: 0, r1: len - 1, t0: cur.track, t1: cur.track }
          for (let ti = t0; ti <= t1; ti++) {
            const tid = ids[ti]
            if (!tid) continue
            for (let r = r0; r <= r1; r++) {
              const note = cellAt(tid, r)?.note
              if (note != null) store.setCellNote(tid, r, note + step)
            }
          }
          return
        }
      }
      return
    }

    // --- Ctrl: track management, effect lanes ---
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      switch (e.code) {
        case 'Backspace': e.preventDefault(); if (trackId) { store.removeTrack(trackId); focusTrack(cur.track) } return
        case 'ArrowUp': e.preventDefault(); if (trackId) store.shiftTrack(trackId, 'up'); return
        case 'ArrowDown': e.preventDefault(); if (trackId) store.shiftTrack(trackId, 'down'); return
        case 'Equal': {
          e.preventDefault()
          const inheritId = store.doc.entities.tracks[trackId]?.instrumentId
            ?? Object.keys(store.doc.entities.instruments)[0]
            ?? store.addInstrument('modular')
          store.addTrack(cur.track + 1, inheritId)
          focusTrack(cur.track + 1)
          return
        }
        case 'Comma': e.preventDefault(); store.moveTrack(cur.track, cur.track - 1); focusTrack(cur.track - 1); return
        case 'Period': e.preventDefault(); store.moveTrack(cur.track, cur.track + 1); focusTrack(cur.track + 1); return
        case 'KeyL': e.preventDefault(); if (trackId) store.addEffectLane(trackId, 'panning'); return
        case 'KeyK': {
          e.preventDefault()
          const lanes = trackId ? store.doc.entities.tracks[trackId]?.effectLanes : undefined
          if (trackId && lanes?.length) {
            store.removeEffectLane(trackId, lanes[lanes.length - 1].id)
            setCursor({ ...getCursor(), col: Math.min(cur.col, 1), laneIndex: null })
          }
          return
        }
      }
      return
    }

    // --- Alt: beat jumps ---
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.code === 'ArrowUp') { moveTo(snapRow(cur, 4, -1, len)); return }
      if (e.code === 'ArrowDown') { moveTo(snapRow(cur, 4, 1, len)); return }
    }

    // --- Navigation ---
    if (e.code === 'Home') { e.preventDefault(); clearEntry(); setCursor({ ...cur, row: 0 }); return }
    if (e.code === 'End') { e.preventDefault(); clearEntry(); setCursor({ ...cur, row: len - 1 }); return }
    if (e.code === 'ArrowDown') { moveTo(stepRow(cur, 1, len)); return }
    if (e.code === 'ArrowUp') { moveTo(stepRow(cur, -1, len)); return }
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault()
      clearEntry()
      if (!ids.length) return
      moveTo(e.code === 'ArrowRight' ? moveRight(cur, laneCount, ids.length) : moveLeft(cur, laneCount, ids.length))
      return
    }

    // --- Clear the selection, or the cell under the cursor ---
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault()
      if (sel) {
        const { r0, r1, t0, t1 } = selectionBounds(sel)
        for (let ti = t0; ti <= t1; ti++) {
          const tid = ids[ti]
          if (!tid) continue
          const lanes = useDocStore.getState().doc.entities.tracks[tid]?.effectLanes ?? []
          for (let r = r0; r <= r1; r++) {
            store.setCellNote(tid, r, null)
            store.setCellVolume(tid, r, null)
            for (const lane of lanes) store.setCellEffectLane(tid, r, lane.id, null)
          }
        }
        setSelection(null)
      } else if (trackId) {
        const track = store.doc.entities.tracks[trackId]
        if (cur.col >= 2 && cur.laneIndex !== null && track) {
          const laneId = track.effectLanes[cur.laneIndex]?.id
          if (laneId) { store.setCellEffectLane(trackId, cur.row, laneId, null); clearEntry(); advance() }
        } else if (cur.col === 1) {
          store.setCellVolume(trackId, cur.row, null); clearEntry(); advance()
        } else {
          store.setCellNote(trackId, cur.row, null); advance()
        }
      }
      return
    }

    // --- Volume column: two hex digits; other keys do nothing here ---
    if (noMods && cur.col === 1) {
      const hex = keyToHex(e.code)
      if (hex !== undefined && trackId) {
        e.preventDefault(); setSelection(null)
        const { value, pending } = enterHexDigit(volumeEntryRef.current, hex)
        store.setCellVolume(trackId, cur.row, value)
        if (pending === null) { clearEntry(); advance() } else setVolumeEntry(pending)
      }
      return
    }

    // --- Effect lane column: two hex digits ---
    if (noMods && cur.col >= 2 && cur.laneIndex !== null && trackId) {
      const hex = keyToHex(e.code)
      if (hex !== undefined) {
        e.preventDefault(); setSelection(null)
        const laneId = store.doc.entities.tracks[trackId]?.effectLanes[cur.laneIndex]?.id
        if (!laneId) return
        const { value, pending } = enterHexDigit(laneEntryRef.current, hex)
        store.setCellEffectLane(trackId, cur.row, laneId, value)
        if (pending === null) { clearEntry(); advance() } else setLaneEntry(pending)
      }
      return
    }

    if (!noMods) return

    // --- Hold (backslash, shown as '|') ---
    if (e.code === 'Backslash') {
      e.preventDefault(); setSelection(null)
      if (trackId) { store.setCellHold(trackId, cur.row, !cellAt(trackId, cur.row)?.hold); advance() }
      return
    }

    // --- Volume nudge: [ / ] ---
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      e.preventDefault(); setSelection(null)
      if (trackId) {
        const volume = cellAt(trackId, cur.row)?.volume ?? 1
        const step = e.code === 'BracketLeft' ? -1 / 16 : 1 / 16
        store.setCellVolume(trackId, cur.row, Math.max(0, Math.min(1, volume + step)))
      }
      return
    }

    // --- Note entry, with a short preview through the track's voice slot ---
    const semi = codeToSemitone(e.code)
    if (semi !== undefined && trackId) {
      e.preventDefault(); setSelection(null)
      const note = useAppStore.getState().octave * 12 + semi
      store.setCellNote(trackId, cur.row, note)
      const instId = useAppStore.getState().selectedInstrumentId
      if (instId) {
        const slot = trackLiveSlot(useDocStore.getState().doc, trackId, instId)
        void host.start().then(() => {
          keyboardPlayer.noteOn(instId, note, undefined, slot)
          setTimeout(() => keyboardPlayer.noteOffNote(instId, note), 120)
        })
      }
      advance()
    }
  }, [host, keyboardPlayer, clearEntry, setSelection, setVolumeEntry, setLaneEntry])

  return { selection, volumeEntry, laneEntry, onCellClick, handleKeyDown }
}
