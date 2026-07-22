import { useState } from 'react'
import type { Doc, Id, Pattern } from '../domain/types'
import { midiToName } from '../domain/notes'
import { effectDisplay } from '../domain/effects'
import { useDocStore } from '../state/docStore'

export interface Cursor {
  row: number
  track: number
  /** 0 = note column, 1 = volume column, 2 = effect column. */
  col: 0 | 1 | 2
}

export interface Selection {
  startRow: number
  startTrack: number
  endRow: number
  endTrack: number
}

interface Props {
  doc: Doc
  pattern: Pattern
  cursor: Cursor
  playhead: number | null
  muted: Record<Id, boolean>
  soloed: Record<Id, boolean>
  selection: Selection | null
  /** Pending high nibble (0-15) for two-digit hex volume entry, or null. */
  volumeEntry: number | null
  onCellClick: (row: number, track: number, shiftKey: boolean) => void
}

/** Format volume 0..1 as a tracker-style hex value 00..FF. */
function volHex(v: number | null): string {
  if (v === null) return '··'
  const hex = Math.round(v * 255).toString(16).toUpperCase()
  return hex.length === 1 ? '0' + hex : hex
}

/** Read-only presentation of the current pattern. Editing happens via keys. */
function inSelection(
  sel: Selection | null, row: number, track: number,
): boolean {
  if (!sel) return false
  const r0 = Math.min(sel.startRow, sel.endRow)
  const r1 = Math.max(sel.startRow, sel.endRow)
  const t0 = Math.min(sel.startTrack, sel.endTrack)
  const t1 = Math.max(sel.startTrack, sel.endTrack)
  return row >= r0 && row <= r1 && track >= t0 && track <= t1
}

export function TrackerGrid({ doc, pattern, cursor, playhead, muted, soloed, selection, volumeEntry, onCellClick }: Props) {
  const tracks = pattern.trackIds.map((id) => doc.entities.tracks[id])
  const setTrackInstrument = useDocStore((s) => s.setTrackInstrument)
  const renamePattern = useDocStore((s) => s.renamePattern)
  const setPatternLength = useDocStore((s) => s.setPatternLength)
  const instruments = Object.values(doc.entities.instruments)
  const [editingName, setEditingName] = useState(false)

  return (
    <div className="grid">
      {/* Pattern header: name + length controls */}
      <div className="pattern-head">
        {editingName ? (
          <input
            className="pattern-name-input"
            defaultValue={pattern.name}
            autoFocus
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                renamePattern(pattern.id, (e.target as HTMLInputElement).value)
                setEditingName(false)
              }
              if (e.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <span
            className="pattern-name"
            title="Double-click to rename"
            onDoubleClick={() => setEditingName(true)}
          >
            {pattern.name}
          </span>
        )}
        <span className="pattern-length">
          <button
            className="lenbtn"
            title="Decrease length · hold Shift for −4"
            onClick={(e) => setPatternLength(pattern.id, Math.max(1, pattern.length - (e.shiftKey ? 4 : 1)))}
          >
            −
          </button>
          <span className="lenval">{pattern.length}</span>
          <button
            className="lenbtn"
            title="Increase length · hold Shift for +4"
            onClick={(e) => setPatternLength(pattern.id, Math.min(256, pattern.length + (e.shiftKey ? 4 : 1)))}
          >
            +
          </button>
          <span className="muted">rows</span>
        </span>
      </div>

      {/* Track headers */}
      <div className="grid-row grid-head">
        <span className="cell rownum">##</span>
        {tracks.map((t, ti) => {
          const isMuted = muted[t.id] === true
          const isSoloed = soloed[t.id] === true
          return (
            <span key={t.id} className={'cell track-head' + (isMuted ? ' muted' : '') + (isSoloed ? ' soloed' : '')}>
              <span className="track-no">
                {ti + 1}
                {isSoloed && <span className="solo-tag">S</span>}
                {isMuted && <span className="mute-tag">M</span>}
              </span>
              <select
                className="track-inst"
                value={t.instrumentId}
                onChange={(e) => setTrackInstrument(t.id, e.target.value)}
                title="Instrument for this track"
              >
                {instruments.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
            </span>
          )
        })}
      </div>

      {/* Grid rows */}
      {Array.from({ length: pattern.length }, (_, row) => (
        <div
          key={row}
          className={
            'grid-row' +
            (row === playhead ? ' playhead' : '') +
            (row % 4 === 0 ? ' beat' : '')
          }
        >
          <span className="cell rownum">{row.toString().padStart(2, '0')}</span>
          {tracks.map((t, ti) => {
            const cell = t.cells[row]
            const note = cell?.note ?? null
            const noteOff = cell?.noteOff === true
            const active = ti === cursor.track && row === cursor.row
            const noteActive = active && cursor.col === 0
            const volActive = active && cursor.col === 1
            const effActive = active && cursor.col === 2
            const sel = inSelection(selection, row, ti)
            const mutedClass = muted[t.id] ? ' muted' : ''

            let noteLabel: string
            if (noteOff) noteLabel = '==='
            else if (note === null) noteLabel = '···'
            else noteLabel = midiToName(note)

            const isEnteringVol = active && cursor.col === 1 && volumeEntry !== null
            const volLabel = isEnteringVol
              ? volumeEntry.toString(16).toUpperCase() + '·'
              : volHex(cell?.volume ?? null)

            const effLabel = cell?.effect != null
              ? effectDisplay(cell.effect)
              : '···'

            return (
              <span
                key={t.id}
                className={'cell' + (active ? ' cursor' : '') + (sel ? ' selected' : '') + mutedClass + (noteOff ? ' noteoff' : '')}
                onMouseDown={(e) => { e.preventDefault(); onCellClick(row, ti, e.shiftKey) }}
              >
                <span className={'cell-note' + (noteActive ? ' sub-active' : '')}>{noteLabel}</span>
                <span className={'cell-vol' + (volActive ? ' sub-active' : '')}>{volLabel}</span>
                <span className={'cell-eff' + (effActive ? ' sub-active' : '')}>{effLabel}</span>
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
