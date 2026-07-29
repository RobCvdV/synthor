import { useState, useMemo } from 'react'
import type { Doc, Id, Pattern } from '../domain/types'
import { midiToName } from '../domain/notes'
import { isBuiltinLaneType, LANE_DEFS, readableLaneLabel, valueHex } from '../domain/effects'
import { useDocStore } from '../state/docStore'

export interface Cursor {
  row: number
  track: number
  /** 0 = note column, 1 = volume column, 2+ = effect lane columns. */
  col: number
  /** When col >= 2, index into the track's effectLanes array (0-based). */
  laneIndex: number | null
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
  /** Pending high nibble (0-15) for two-digit hex entry, or null. */
  volumeEntry: number | null
  /** Pending high nibble (0-15) for lane value hex entry, or null. */
  laneEntry: number | null
  onCellClick: (row: number, track: number, shiftKey: boolean) => void
}

/** Subtle dark backgrounds for lane color-coding — distinct enough to differentiate
 *  adjacent lanes but dark enough to keep text readable. Index by lane position. */
const LANE_COLORS = [
  '#191f2b', '#1f1926', '#19261f', '#231e18',
  '#172428', '#211724', '#1a2418', '#211720',
]

function laneBg(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length]
}

/** 82px base (padding + 48px note + 24px vol + gaps) + 22px per lane. */
function trackCellWidth(laneCount: number): number {
  return 82 + laneCount * 22
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

export function TrackerGrid({ doc, pattern, cursor, playhead, muted, soloed, selection, volumeEntry, laneEntry, onCellClick }: Props) {
  const tracks = pattern.trackIds.map((id) => doc.entities.tracks[id])
  const setTrackInstrument = useDocStore((s) => s.setTrackInstrument)
  const addEffectLane = useDocStore((s) => s.addEffectLane)
  const removeEffectLane = useDocStore((s) => s.removeEffectLane)
  const renamePattern = useDocStore((s) => s.renamePattern)
  const setPatternLength = useDocStore((s) => s.setPatternLength)
  const instruments = Object.values(doc.entities.instruments)
  const [editingName, setEditingName] = useState(false)

  /** Get named inlet options from the instrument assigned to a track. */
  const getInletOptions = useMemo(() => {
    const cache: Record<Id, { name: string }[]> = {}
    for (const inst of instruments) {
      if (inst.kind !== 'modular') { cache[inst.id] = []; continue }
      const names: { name: string }[] = []
      for (const m of Object.values(inst.modules)) {
        if (m.type === 'eff' && m.name) {
          names.push({ name: m.name })
        }
      }
      cache[inst.id] = names
    }
    return cache
  }, [instruments])

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
          const inletOptions = getInletOptions[t.instrumentId] ?? []

          return (
            <span key={t.id} className={'cell track-head' + (isMuted ? ' muted' : '') + (isSoloed ? ' soloed' : '')} style={{ width: trackCellWidth(t.effectLanes.length) }}>
              <span className="track-no">
                {ti + 1}
                {isSoloed && <span className="solo-tag">S</span>}
                {isMuted && <span className="mute-tag">M</span>}
              </span>
              <select
                className="track-inst"
                value={t.instrumentId}
                onChange={(e) => { setTrackInstrument(t.id, e.target.value); (e.target as HTMLSelectElement).blur() }}
                title="Instrument for this track"
              >
                {instruments.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
              {/* Effect lane management */}
              <div className="track-lanes">
                {t.effectLanes.map((lane, _li) => {
                  const isAvailable = isBuiltinLaneType(lane.type) ||
                    inletOptions.some((io) => io.name === lane.type)
                  return (
                    <span
                      key={lane.id}
                      className={'lane-pill' + (isAvailable ? '' : ' lane-unavailable')}
                      title={isAvailable ? readableLaneLabel(lane.type) : `${lane.type} (unavailable)`}
                      style={{ backgroundColor: laneBg(_li) }}
                    >
                      <span className="lane-label">{readableLaneLabel(lane.type)}</span>
                      <button
                        className="lane-del"
                        onClick={(e) => { e.stopPropagation(); removeEffectLane(t.id, lane.id) }}
                        title="Remove lane"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
                <select
                  className="track-add-lane"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) { addEffectLane(t.id, e.target.value); e.target.value = ''; (e.target as HTMLSelectElement).blur() }
                  }}
                  title="Add effect lane"
                >
                  <option value="">+ lane</option>
                  <optgroup label="Built-in">
                    {Object.entries(LANE_DEFS).map(([type, def]) => (
                      <option key={type} value={type}>{def.label} — {def.description}</option>
                    ))}
                  </optgroup>
                  {inletOptions.length > 0 && (
                    <optgroup label="Instrument Inlets">
                      {inletOptions.map((io) => (
                        <option key={io.name} value={io.name}>{io.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
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
            const sel = inSelection(selection, row, ti)
            const mutedClass = muted[t.id] ? ' muted' : ''

            let noteLabel: string
            if (noteOff) noteLabel = '==='
            else if (note === null) noteLabel = '···'
            else noteLabel = midiToName(note)

            const isEnteringVol = active && cursor.col === 1 && volumeEntry !== null
            const volLabel = isEnteringVol
              ? volumeEntry.toString(16).toUpperCase() + '·'
              : valueHex(cell?.volume ?? null)

            // Per-lane effect columns.
            const laneColumns = t.effectLanes.map((lane, li) => {
              const laneActive = active && cursor.col >= 2 && cursor.laneIndex === li
              const isEnteringLane = laneActive && laneEntry !== null
              const val = cell?.effectLanes[lane.id] ?? null
              const label = isEnteringLane
                ? laneEntry.toString(16).toUpperCase() + '·'
                : valueHex(val)
              return (
                <span
                  key={lane.id}
                  className={'cell-eff' + (laneActive ? ' sub-active' : '')}
                  style={laneActive ? undefined : { backgroundColor: laneBg(li) }}
                >
                  {label}
                </span>
              )
            })

            return (
              <span
                key={t.id}
                className={'cell' + (active ? ' cursor' : '') + (sel ? ' selected' : '') + mutedClass + (noteOff ? ' noteoff' : '')}
                style={{ width: trackCellWidth(t.effectLanes.length) }}
                onMouseDown={(e) => { e.preventDefault(); onCellClick(row, ti, e.shiftKey) }}
              >
                <span className={'cell-note' + (noteActive ? ' sub-active' : '')}>{noteLabel}</span>
                <span className={'cell-vol' + (volActive ? ' sub-active' : '')}>{volLabel}</span>
                {laneColumns}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
