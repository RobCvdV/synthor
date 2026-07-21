interface Row {
  keys: string
  label: string
}

const NOTE_ENTRY: Row[] = [
  { keys: 'Z … M', label: 'notes (lower octave)' },
  { keys: 'Q … U', label: 'notes (upper octave)' },
  { keys: 'S D G H J …', label: 'sharps (lower)' },
  { keys: '2 3 5 6 7 …', label: 'sharps (upper)' },
  { keys: '− / =', label: 'octave down / up' },
  { keys: '`', label: 'note-off (toggle)' },
  { keys: '[ / ]', label: 'volume down / up' },
  { keys: 'Del', label: 'clear cell' },
]

const TRANSPORT: Row[] = [
  { keys: 'Space', label: 'play / stop (from cursor)' },
  { keys: '⌘ Space', label: 'play from top' },
  { keys: '↑ ↓', label: 'move row' },
  { keys: '← →', label: 'note ↔ vol ↔ track' },
  { keys: '⇧ arrows', label: 'select region' },
  { keys: '⌥ ↑/↓', label: 'jump 4 rows (snap to grid)' },
  { keys: '⌘ ↑/↓', label: 'jump 8 rows (snap to grid)' },
  { keys: 'Home / End', label: 'top / bottom' },
  { keys: '⌘Z / ⌘⇧Z', label: 'undo / redo' },
]

const TRACK_OPS: Row[] = [
  { keys: 'Ctrl =', label: 'add track to right' },
  { keys: 'Ctrl , / .', label: 'move track left / right' },
  { keys: 'Ctrl C / X / V', label: 'copy / cut / paste' },
  { keys: 'Ctrl D', label: 'duplicate track' },
  { keys: 'Ctrl ⌫', label: 'delete track' },
  { keys: 'Del / ⌫', label: 'clear cell / selection' },
  { keys: 'Ctrl ↑ / ↓', label: 'shift notes up / down' },
]

const MUTE: Row[] = [{ keys: 'F1 … F12', label: 'mute track 1 … 12' }]

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="legend-section">
      <h4>{title}</h4>
      {rows.map((r) => (
        <div key={r.keys + r.label} className="legend-row">
          <kbd>{r.keys}</kbd>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend() {
  return (
    <aside className="legend">
      <Section title="Note entry" rows={NOTE_ENTRY} />
      <Section title="Transport & cursor" rows={TRANSPORT} />
      <Section title="Track (Ctrl)" rows={TRACK_OPS} />
      <Section title="Mute" rows={MUTE} />
    </aside>
  )
}
