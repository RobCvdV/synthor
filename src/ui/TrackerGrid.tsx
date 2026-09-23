import { memo, useCallback, useMemo, useState } from 'react'
import type { Doc, Id, Pattern, Track } from '../domain/types'
import type { Instrument } from '../domain/types'
import { midiToName } from '../domain/notes'
import { effInletNames, isBuiltinLaneType, LANE_DEFS, readableLaneLabel, valueHex } from '../domain/effects'
import { useDocStore } from '../state/docStore'
import { usePlayheadRow } from './usePlayhead'

export interface Cursor {
  row: number
  track: number
  col: number
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
  muted: Record<number, boolean>
  soloed: Record<number, boolean>
  selection: Selection | null
  volumeEntry: number | null
  laneEntry: number | null
  onCellClick: (row: number, track: number, shiftKey: boolean) => void
}

/** Subtle dark backgrounds for lane color-coding. */
const LANE_COLORS = [
  '#191f2b', '#1f1926', '#19261f', '#231e18',
  '#172428', '#211724', '#1a2418', '#211720',
]

function laneBg(index: number): string { return LANE_COLORS[index % LANE_COLORS.length] }
function trackCellWidth(laneCount: number): number { return 82 + laneCount * 22 }

function inSelection(sel: Selection | null, row: number, track: number): boolean {
  if (!sel) return false
  const r0 = Math.min(sel.startRow, sel.endRow)
  const r1 = Math.max(sel.startRow, sel.endRow)
  const t0 = Math.min(sel.startTrack, sel.endTrack)
  const t1 = Math.max(sel.startTrack, sel.endTrack)
  return row >= r0 && row <= r1 && track >= t0 && track <= t1
}

// ── TrackerHeader ────────────────────────────────────────────────────────────

interface HeaderProps {
  patternId: Id; patternName: string; patternLength: number
  tracks: Track[]; instruments: Instrument[]
  inletOptions: Record<Id, string[]>
  muted: Record<number, boolean>; soloed: Record<number, boolean>
}

const TrackerHeader = memo(function TrackerHeader({
  patternId, patternName, patternLength, tracks, instruments, inletOptions, muted, soloed,
}: HeaderProps) {
  const [editingName, setEditingName] = useState(false)

  const renamePattern = useDocStore((s) => s.renamePattern)
  const setPatternLength = useDocStore((s) => s.setPatternLength)
  const setTrackInstrument = useDocStore((s) => s.setTrackInstrument)
  const addEffectLane = useDocStore((s) => s.addEffectLane)
  const removeEffectLane = useDocStore((s) => s.removeEffectLane)

  return (
    <>
      <div className="pattern-head">
        {editingName ? (
          <input className="pattern-name-input" defaultValue={patternName} autoFocus
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { renamePattern(patternId, (e.target as HTMLInputElement).value); setEditingName(false) }
              if (e.key === 'Escape') setEditingName(false)
            }} />
        ) : (
          <span className="pattern-name" title="Double-click to rename" onDoubleClick={() => setEditingName(true)}>
            {patternName}
          </span>
        )}
        <span className="pattern-length">
          <button className="lenbtn" title="Decrease length · hold Shift for −4"
            onClick={(e) => setPatternLength(patternId, Math.max(1, patternLength - (e.shiftKey ? 4 : 1)))}>−</button>
          <span className="lenval">{patternLength}</span>
          <button className="lenbtn" title="Increase length · hold Shift for +4"
            onClick={(e) => setPatternLength(patternId, Math.min(256, patternLength + (e.shiftKey ? 4 : 1)))}>+</button>
          <span className="muted">rows</span>
        </span>
      </div>

      <div className="grid-row grid-head">
        <span className="cell rownum">##</span>
        {tracks.map((t, ti) => {
          const isMuted = muted[ti + 1] === true
          const isSoloed = soloed[ti + 1] === true
          const inletOpts = inletOptions[t.instrumentId] ?? []
          return (
            <span key={t.id} className={'cell track-head' + (isMuted ? ' muted' : '') + (isSoloed ? ' soloed' : '')}
              style={{ width: trackCellWidth(t.effectLanes.length) }}>
              <span className="track-no">{ti + 1}{isSoloed && <span className="solo-tag">S</span>}{isMuted && <span className="mute-tag">M</span>}</span>
              <select className="track-inst" value={t.instrumentId}
                onChange={(e) => { setTrackInstrument(t.id, e.target.value); (e.target as HTMLSelectElement).blur() }}
                title="Instrument for this track">
                {instruments.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
              </select>
              <div className="track-lanes">
                {t.effectLanes.map((lane, _li) => {
                  const avail = isBuiltinLaneType(lane.type) || inletOpts.some((io) => io === lane.type)
                  return (
                    <span key={lane.id} className={'lane-pill' + (avail ? '' : ' lane-unavailable')}
                      title={avail ? readableLaneLabel(lane.type) : `${lane.type} (unavailable)`}
                      style={{ backgroundColor: laneBg(_li) }}>
                      <span className="lane-label">{readableLaneLabel(lane.type)}</span>
                      <button className="lane-del" onClick={(e) => { e.stopPropagation(); removeEffectLane(t.id, lane.id) }}
                        title="Remove lane">×</button>
                    </span>
                  )
                })}
                <select className="track-add-lane" value=""
                  onChange={(e) => { if (e.target.value) { addEffectLane(t.id, e.target.value); e.target.value = ''; (e.target as HTMLSelectElement).blur() } }}
                  title="Add effect lane">
                  <option value="">+ lane</option>
                  <optgroup label="Built-in">
                    {Object.entries(LANE_DEFS).map(([type, def]) => <option key={type} value={type}>{def.label} — {def.description}</option>)}
                  </optgroup>
                  {inletOpts.length > 0 && <optgroup label="Instrument Inlets">{inletOpts.map((io) => <option key={io} value={io}>{io}</option>)}</optgroup>}
                </select>
              </div>
            </span>
          )
        })}
      </div>
    </>
  )
})

// ── TrackerCell ──────────────────────────────────────────────────────────────

interface CellProps {
  noteLabel: string; volLabel: string
  laneColumns: { id: Id; label: string; active: boolean }[]
  active: boolean; noteActive: boolean; volActive: boolean
  sel: boolean; muted: boolean; hold: boolean; noteOff: boolean
  width: number
  row: number; track: number
  onCellClick: (row: number, track: number, shiftKey: boolean) => void
}

const TrackerCell = memo(function TrackerCell({
  noteLabel, volLabel, laneColumns, active, noteActive, volActive, sel, muted, hold, noteOff, width,
  row, track, onCellClick,
}: CellProps) {
  const cls = 'cell' + (active ? ' cursor' : '') + (sel ? ' selected' : '') +
    (muted ? ' muted' : '') + (hold ? ' hold' : noteOff ? ' noteoff' : '')
  const onMouseDown = useCallback((e: React.MouseEvent) => { e.preventDefault(); onCellClick(row, track, e.shiftKey) }, [row, track, onCellClick])

  return (
    <span className={cls} style={{ width }} onMouseDown={onMouseDown}>
      <span className={'cell-note' + (noteActive ? ' sub-active' : '')}>{noteLabel}</span>
      <span className={'cell-vol' + (volActive ? ' sub-active' : '')}>{volLabel}</span>
      {laneColumns.map((lc) => (
        <span key={lc.id} className={'cell-eff' + (lc.active ? ' sub-active' : '')}>{lc.label}</span>
      ))}
    </span>
  )
})

// ── TrackerRow ───────────────────────────────────────────────────────────────

interface RowProps {
  row: number; tracks: Track[]
  isBeat: boolean; isPlayhead: boolean
  isCursorRow: boolean; cursorTrack: number; cursorCol: number; cursorLaneIndex: number | null
  sel: Selection | null
  mutedTracks: Record<number, boolean>
  volEntry: number | null; laneEntry: number | null
  onCellClick: (row: number, track: number, shiftKey: boolean) => void
}

const TrackerRowImpl = memo(function TrackerRowImpl({
  row, tracks, isBeat, isPlayhead, isCursorRow, cursorTrack, cursorCol, cursorLaneIndex,
  sel, mutedTracks, volEntry, laneEntry, onCellClick,
}: RowProps) {
  return (
    <div className={'grid-row' + (isPlayhead ? ' playhead' : '') + (isBeat ? ' beat' : '')}>
      <span className="cell rownum">{row.toString().padStart(2, '0')}</span>
      {tracks.map((t, ti) => {
        const cell = t.cells[row]
        const note = cell?.note ?? null
        const noteOff = cell?.noteOff === true
        const hold = cell?.hold === true
        const active = isCursorRow && ti === cursorTrack
        const noteActive = active && cursorCol === 0
        const volActive = active && cursorCol === 1
        const inSel = inSelection(sel, row, ti)
        const muted = mutedTracks[ti + 1] === true

        let noteLabel: string
        if (hold) noteLabel = '|'
        else if (noteOff) noteLabel = '==='
        else if (note === null) noteLabel = '···'
        else noteLabel = midiToName(note)

        const isEnteringVol = active && cursorCol === 1 && volEntry !== null
        const volLabel = isEnteringVol ? volEntry.toString(16).toUpperCase() + '·' : valueHex(cell?.volume ?? null)

        const laneColumns = t.effectLanes.map((lane, li) => {
          const laneActive = active && cursorCol >= 2 && cursorLaneIndex === li
          const isEnteringLane = laneActive && laneEntry !== null
          const val = cell?.effectLanes[lane.id] ?? null
          const label = isEnteringLane ? laneEntry.toString(16).toUpperCase() + '·' : valueHex(val)
          return {
            id: lane.id,
            label,
            active: laneActive,
          }
        })

        return (
          <TrackerCell
            key={t.id}
            noteLabel={noteLabel} volLabel={volLabel} laneColumns={laneColumns}
            active={active} noteActive={noteActive} volActive={volActive}
            sel={inSel} muted={muted} hold={hold} noteOff={noteOff}
            width={trackCellWidth(t.effectLanes.length)}
            row={row} track={ti}
            onCellClick={onCellClick}
          />
        )
      })}
    </div>
  )
})

// ── TrackerGrid ──────────────────────────────────────────────────────────────

export function TrackerGrid({ doc, pattern, cursor, muted, soloed, selection, volumeEntry, laneEntry, onCellClick }: Props) {
  const tracks = pattern.trackIds.map((id) => doc.entities.tracks[id])
  const playhead = usePlayheadRow()
  const instruments = Object.values(doc.entities.instruments)

  const getInletOptions = useMemo(() => {
    const cache: Record<Id, string[]> = {}
    for (const inst of instruments) cache[inst.id] = effInletNames(inst)
    return cache
  }, [instruments])

  return (
    <div className="grid">
      <TrackerHeader
        patternId={pattern.id} patternName={pattern.name} patternLength={pattern.length}
        tracks={tracks} instruments={instruments} inletOptions={getInletOptions}
        muted={muted} soloed={soloed}
      />

      {Array.from({ length: pattern.length }, (_, row) => (
        <TrackerRowImpl
          key={row}
          row={row} tracks={tracks}
          isBeat={row % 4 === 0} isPlayhead={row === playhead}
          isCursorRow={row === cursor.row} cursorTrack={cursor.track}
          cursorCol={cursor.col} cursorLaneIndex={cursor.laneIndex}
          sel={selection}
          mutedTracks={muted}
          volEntry={isCursorRow(row, cursor, 1) ? volumeEntry : null}
          laneEntry={isCursorRow(row, cursor) ? laneEntry : null}
          onCellClick={onCellClick}
        />
      ))}
    </div>
  )
}

function isCursorRow(row: number, cursor: Cursor, col?: number): boolean {
  if (row !== cursor.row) return false
  if (col !== undefined && cursor.col !== col) return false
  return true
}