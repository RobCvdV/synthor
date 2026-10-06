import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Doc, Id, Pattern, Track } from '../../domain/types'
import type { Instrument } from '../../domain/types'
import { midiToName } from '../../domain/notes'
import { effInletNames, isBuiltinLaneType, LANE_DEFS, readableLaneLabel, valueHex } from '../../domain/effects'
import { useDocStore } from '../../state/docStore'
import { MAX_EDIT_STEP, useAppStore } from '../../state/appStore'
import { EditableLabel } from '../components/EditableLabel'
import { InstrumentSelect } from '../components/InstrumentSelect'
import { usePlayheadRow } from '../usePlayhead'
import { clipboardLabel, scrollTopFor, selectionMasks, type Selection } from './trackerNav'
import type { ColumnMask } from '../../state/docStoreTypes'

export interface Cursor {
  row: number
  track: number
  col: number
  laneIndex: number | null
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
  onCellClick: CellClick
  onCellDrag: CellDrag
}

type CellClick = (row: number, track: number, shiftKey: boolean, col?: number) => void
type CellDrag = (row: number, track: number, col?: number) => void

/** Subtle dark backgrounds for lane color-coding. */
const LANE_COLORS = [
  '#191f2b', '#1f1926', '#19261f', '#231e18',
  '#172428', '#211724', '#1a2418', '#211720',
]

function laneBg(index: number): string { return LANE_COLORS[index % LANE_COLORS.length] }
function trackCellWidth(laneCount: number): number { return 82 + laneCount * 22 }

// ── PatternHead ──────────────────────────────────────────────────────────────

interface PatternHeadProps {
  patternId: Id; patternName: string; patternLength: number
  followPaused: boolean
}

const PatternHead = memo(function PatternHead({ patternId, patternName, patternLength, followPaused }: PatternHeadProps) {
  const editStep = useAppStore((s) => s.editStep)
  const setEditStep = useAppStore((s) => s.setEditStep)
  const follow = useAppStore((s) => s.followPlayhead)
  const setFollow = useAppStore((s) => s.setFollowPlayhead)
  const editMode = useAppStore((s) => s.editMode)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const renamePattern = useDocStore((s) => s.renamePattern)
  const setPatternLength = useDocStore((s) => s.setPatternLength)
  const rectClipboard = useDocStore((s) => s.rectClipboard)
  const trackClipboard = useDocStore((s) => s.trackClipboard)
  const clip = clipboardLabel(rectClipboard, trackClipboard)

  return (
    <div className="pattern-head">
      <EditableLabel value={patternName} onCommit={(name) => renamePattern(patternId, name)}
        className="pattern-name" inputClassName="pattern-name-input" />
      <span className="pattern-length">
        <button className="lenbtn" title="Decrease length · hold Shift for −4"
          onClick={(e) => setPatternLength(patternId, Math.max(1, patternLength - (e.shiftKey ? 4 : 1)))}>−</button>
        <span className="lenval">{patternLength}</span>
        <button className="lenbtn" title="Increase length · hold Shift for +4"
          onClick={(e) => setPatternLength(patternId, Math.min(256, patternLength + (e.shiftKey ? 4 : 1)))}>+</button>
        <span className="muted">rows</span>
      </span>
      <span className="pattern-length" title="Edit step: rows to advance after an entry (Alt+0…9)">
        <button className="lenbtn" onClick={() => setEditStep(editStep - 1)}>−</button>
        <span className="lenval">{editStep}</span>
        <button className="lenbtn" onClick={() => setEditStep(Math.min(MAX_EDIT_STEP, editStep + 1))}>+</button>
        <span className="muted">step</span>
      </span>
      <button className={'follow-btn' + (follow ? ' on' : '') + (follow && followPaused ? ' paused' : '')}
        onClick={() => setFollow(!follow)}
        title={follow && followPaused
          ? 'Follow paused by a cursor move — resumes on the next play (Ctrl+F toggles)'
          : 'Keep the playhead in view while playing (Ctrl+F)'}>
        Follow{follow && followPaused ? ' ⏸' : ''}
      </button>
      <button className={'follow-btn' + (editMode ? ' on' : '')} onClick={() => setEditMode(!editMode)}
        title={editMode ? 'Editing: keys write into the grid (⌘E: play only)' : 'Play only: note keys just play (⌘E: edit)'}>
        {editMode ? 'Edit' : 'Play only'}
      </button>
      <span className={'clip-ind' + (clip ? ' full' : '')}
        title={clip ? `⌘V pastes: ${clip}` : 'Nothing copied — ⌘C copies the selection, or the track without one'}>
        Clip: {clip ?? 'empty'}
      </span>
    </div>
  )
})

// ── TrackerHeader ────────────────────────────────────────────────────────────

interface HeaderProps {
  tracks: Track[]; instruments: Instrument[]
  inletOptions: Record<Id, string[]>
  muted: Record<number, boolean>; soloed: Record<number, boolean>
}

const TrackerHeader = memo(function TrackerHeader({ tracks, instruments, inletOptions, muted, soloed }: HeaderProps) {
  const setTrackInstrument = useDocStore((s) => s.setTrackInstrument)
  const addEffectLane = useDocStore((s) => s.addEffectLane)
  const removeEffectLane = useDocStore((s) => s.removeEffectLane)

  return (
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
            <InstrumentSelect className="track-inst" instruments={instruments} value={t.instrumentId}
              onChange={(id) => setTrackInstrument(t.id, id)} title="Instrument for this track" />
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
  )
})

// ── TrackerCell ──────────────────────────────────────────────────────────────

interface CellProps {
  noteLabel: string; volLabel: string
  laneColumns: { id: Id; label: string; active: boolean; sel: boolean }[]
  active: boolean; noteActive: boolean; volActive: boolean
  noteSel: boolean; volSel: boolean; muted: boolean; hold: boolean; noteOff: boolean
  width: number
  row: number; track: number
  onCellClick: CellClick
  onCellDrag: CellDrag
}

const TrackerCell = memo(function TrackerCell({
  noteLabel, volLabel, laneColumns, active, noteActive, volActive, noteSel, volSel, muted, hold, noteOff, width,
  row, track, onCellClick, onCellDrag,
}: CellProps) {
  const cls = 'cell' + (active ? ' cursor' : '') +
    (muted ? ' muted' : '') + (hold ? ' hold' : noteOff ? ' noteoff' : '')
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col
    onCellClick(row, track, e.shiftKey, col === undefined ? undefined : Number(col))
  }, [row, track, onCellClick])
  const onMouseOver = useCallback((e: React.MouseEvent) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col
    onCellDrag(row, track, col === undefined ? undefined : Number(col))
  }, [row, track, onCellDrag])
  const sub = (cls: string, isActive: boolean, isSel: boolean) => cls + (isActive ? ' sub-active' : '') + (isSel ? ' sub-selected' : '')

  return (
    <span className={cls} style={{ width }} onMouseDown={onMouseDown} onMouseOver={onMouseOver}>
      <span data-col={0} className={sub('cell-note', noteActive, noteSel)}>{noteLabel}</span>
      <span data-col={1} className={sub('cell-vol', volActive, volSel)}>{volLabel}</span>
      {laneColumns.map((lc, li) => (
        <span key={lc.id} data-col={2 + li} className={sub('cell-eff', lc.active, lc.sel)}>{lc.label}</span>
      ))}
    </span>
  )
}, cellPropsEqual)

function cellPropsEqual(a: CellProps, b: CellProps): boolean {
  for (const k of Object.keys(a) as (keyof CellProps)[]) {
    if (k !== 'laneColumns' && a[k] !== b[k]) return false
  }
  const la = a.laneColumns, lb = b.laneColumns
  return la.length === lb.length &&
    la.every((c, i) => c.id === lb[i].id && c.label === lb[i].label && c.active === lb[i].active && c.sel === lb[i].sel)
}

// ── TrackerRow ───────────────────────────────────────────────────────────────

interface RowProps {
  row: number; tracks: Track[]
  isBeat: boolean; isPlayhead: boolean
  isCursorRow: boolean; cursorTrack: number; cursorCol: number; cursorLaneIndex: number | null
  /** Per track index, the selected columns on this row; null when the row is outside the selection. */
  selMasks: (ColumnMask | undefined)[] | null
  mutedTracks: Record<number, boolean>
  volEntry: number | null; laneEntry: number | null
  onCellClick: CellClick
  onCellDrag: CellDrag
}

const TrackerRowImpl = memo(function TrackerRowImpl({
  row, tracks, isBeat, isPlayhead, isCursorRow, cursorTrack, cursorCol, cursorLaneIndex,
  selMasks, mutedTracks, volEntry, laneEntry, onCellClick, onCellDrag,
}: RowProps) {
  return (
    <div data-row={row} className={'grid-row' + (isPlayhead ? ' playhead' : '') + (isBeat ? ' beat' : '')}>
      <span className="cell rownum">{row.toString().padStart(2, '0')}</span>
      {tracks.map((t, ti) => {
        const cell = t.cells[row]
        const note = cell?.note ?? null
        const noteOff = cell?.noteOff === true
        const hold = cell?.hold === true
        const active = isCursorRow && ti === cursorTrack
        const noteActive = active && cursorCol === 0
        const volActive = active && cursorCol === 1
        const mask = selMasks?.[ti]
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
            sel: mask?.laneIds.includes(lane.id) ?? false,
          }
        })

        return (
          <TrackerCell
            key={t.id}
            noteLabel={noteLabel} volLabel={volLabel} laneColumns={laneColumns}
            active={active} noteActive={noteActive} volActive={volActive}
            noteSel={mask?.note ?? false} volSel={mask?.volume ?? false} muted={muted} hold={hold} noteOff={noteOff}
            width={trackCellWidth(t.effectLanes.length)}
            row={row} track={ti}
            onCellClick={onCellClick} onCellDrag={onCellDrag}
          />
        )
      })}
    </div>
  )
})

// ── TrackerGrid ──────────────────────────────────────────────────────────────

export function TrackerGrid({ doc, pattern, cursor, muted, soloed, selection, volumeEntry, laneEntry, onCellClick, onCellDrag }: Props) {
  // Stable identities keep the memoized rows from re-rendering on every playhead tick.
  const trackMap = doc.entities.tracks
  const tracks = useMemo(() => pattern.trackIds.map((id) => trackMap[id]), [pattern.trackIds, trackMap])
  const instrumentMap = doc.entities.instruments
  const instruments = useMemo(() => Object.values(instrumentMap), [instrumentMap])
  const playhead = usePlayheadRow()
  const gridRef = useRef<HTMLDivElement>(null)
  const followPaused = useGridScroll(gridRef, cursor.row, playhead)
  const editMode = useAppStore((s) => s.editMode)

  // Masks indexed by track, so rows can look them up directly.
  const selMasks = useMemo(() => {
    if (!selection) return null
    const t0 = Math.min(selection.startTrack, selection.endTrack)
    const out: (ColumnMask | undefined)[] = []
    selectionMasks(selection, tracks).forEach((m, i) => { out[t0 + i] = m })
    return out
  }, [selection, tracks])

  const getInletOptions = useMemo(() => {
    const cache: Record<Id, string[]> = {}
    for (const inst of instruments) cache[inst.id] = effInletNames(inst)
    return cache
  }, [instruments])

  return (
    <div className={'grid' + (editMode ? '' : ' play-only')}>
      <PatternHead patternId={pattern.id} patternName={pattern.name} patternLength={pattern.length}
        followPaused={followPaused} />
      <div className="grid-scroll" ref={gridRef}>
        <TrackerHeader tracks={tracks} instruments={instruments} inletOptions={getInletOptions}
          muted={muted} soloed={soloed} />

        {Array.from({ length: pattern.length }, (_, row) => {
          // Cursor/selection props only reach the rows they affect, so a cursor move re-renders two rows.
          const onCursor = row === cursor.row
          return (
            <TrackerRowImpl
              key={row}
              row={row} tracks={tracks}
              isBeat={row % 4 === 0} isPlayhead={row === playhead}
              isCursorRow={onCursor} cursorTrack={onCursor ? cursor.track : -1}
              cursorCol={onCursor ? cursor.col : -1} cursorLaneIndex={onCursor ? cursor.laneIndex : null}
              selMasks={selectionCoversRow(selection, row) ? selMasks : null}
              mutedTracks={muted}
              volEntry={isCursorRow(row, cursor, 1) ? volumeEntry : null}
              laneEntry={isCursorRow(row, cursor) ? laneEntry : null}
              onCellClick={onCellClick} onCellDrag={onCellDrag}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Keeps the cursor row in view, or with follow on, the playhead row centred while playing.
 * A cursor move during playback pauses following until the next play. Returns whether it's paused.
 */
function useGridScroll(gridRef: RefObject<HTMLDivElement | null>, cursorRow: number, playhead: number): boolean {
  const follow = useAppStore((s) => s.followPlayhead)
  const [paused, setPaused] = useState(false)
  const playing = playhead >= 0
  const following = follow && playing && !paused

  useEffect(() => { if (!playing) setPaused(false) }, [playing])
  useEffect(() => { setPaused(false) }, [follow])

  const scrollTo = useCallback((row: number, mode: 'center' | 'nearest') => {
    const grid = gridRef.current
    const el = grid?.querySelector<HTMLElement>(`[data-row="${row}"]`)
    if (!grid || !el) return
    // The sticky header sits below the grid's top padding, so measure where it ends on screen.
    const head = grid.querySelector<HTMLElement>('.grid-head')
    const headHeight = head ? Math.max(0, head.getBoundingClientRect().bottom - grid.getBoundingClientRect().top - grid.clientTop) : 0
    const top = scrollTopFor(el.offsetTop, el.offsetHeight, { scrollTop: grid.scrollTop, height: grid.clientHeight, headHeight }, mode)
    if (top !== null) grid.scrollTop = top
  }, [gridRef])

  const followingRef = useRef(following)
  useEffect(() => { followingRef.current = following }, [following])
  const mountedRef = useRef(false)
  useEffect(() => {
    if (mountedRef.current && followingRef.current) setPaused(true)
    mountedRef.current = true
    scrollTo(cursorRow, 'nearest')
  }, [cursorRow, scrollTo])

  useEffect(() => { if (following) scrollTo(playhead, 'center') }, [following, playhead, scrollTo])

  return paused
}

function isCursorRow(row: number, cursor: Cursor, col?: number): boolean {
  if (row !== cursor.row) return false
  if (col !== undefined && cursor.col !== col) return false
  return true
}

function selectionCoversRow(sel: Selection | null, row: number): boolean {
  return sel !== null && row >= Math.min(sel.startRow, sel.endRow) && row <= Math.max(sel.startRow, sel.endRow)
}
