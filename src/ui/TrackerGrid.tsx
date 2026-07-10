import type { Doc, Pattern } from '../domain/types'
import { midiToName } from '../domain/notes'

export interface Cursor {
  row: number
  track: number
}

interface Props {
  doc: Doc
  pattern: Pattern
  cursor: Cursor
  playhead: number | null
}

/** Read-only presentation of the current pattern. Editing happens via keys. */
export function TrackerGrid({ doc, pattern, cursor, playhead }: Props) {
  const tracks = pattern.trackIds.map((id) => doc.entities.tracks[id])

  return (
    <div className="grid">
      <div className="grid-row grid-head">
        <span className="cell rownum">##</span>
        {tracks.map((t) => (
          <span key={t.id} className="cell">
            {doc.entities.instruments[t.instrumentId].name}
          </span>
        ))}
      </div>
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
            const note = t.cells[row]?.note ?? null
            const active = ti === cursor.track && row === cursor.row
            return (
              <span key={t.id} className={'cell' + (active ? ' cursor' : '')}>
                {note === null ? '···' : midiToName(note)}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
