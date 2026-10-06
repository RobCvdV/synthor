interface Row {
  keys: string
  label: string
}

interface Group {
  title: string
  rows: Row[]
}

/** Every tracker-view key and mouse action; keep in sync with useAppKeys / useTrackerKeys. */
const GROUPS: Group[] = [
  {
    title: 'Notes & values',
    rows: [
      { keys: 'Z … M', label: 'notes (lower octave)' },
      { keys: 'Q … U', label: 'notes (upper octave)' },
      { keys: 'S D G H J …', label: 'sharps (lower)' },
      { keys: '2 3 5 6 7 …', label: 'sharps (upper)' },
      { keys: '− / =', label: 'octave down / up' },
      { keys: '\\', label: 'hold (continue note, shows |)' },
      { keys: '0-9, A-F', label: 'hex value in vol / lane column' },
      { keys: '[ / ]', label: 'volume down / up' },
      { keys: 'Del / ⌫', label: 'clear cell, or the selection' },
      { keys: '⌥ 0 … 9', label: 'edit step (rows to advance)' },
    ],
  },
  {
    title: 'Cursor & selection',
    rows: [
      { keys: '↑ ↓', label: 'move row' },
      { keys: '← →', label: 'note ↔ vol ↔ lanes ↔ next track' },
      { keys: '⌥ ↑ / ↓', label: 'jump 4 rows (snap to grid)' },
      { keys: '⌘ ↑ / ↓', label: 'jump 8 rows (snap to grid)' },
      { keys: 'Home / End', label: 'top / bottom' },
      { keys: '⇧ arrows', label: 'select region' },
      { keys: 'Click', label: 'move cursor into that column' },
      { keys: '⇧ Click', label: 'extend selection' },
      { keys: 'Drag', label: 'select region' },
    ],
  },
  {
    title: 'Edit',
    rows: [
      { keys: '⌘ E', label: 'edit on / off (off: note keys only play)' },
      { keys: '⌘ C / X / V', label: 'copy / cut / paste (selection, else track)' },
      { keys: '⌘ ⇧ V', label: 'paste only the column at cursor' },
      { keys: '⌘ I', label: 'interpolate selection (vol / lane at cursor)' },
      { keys: '⌘ − / =', label: 'transpose selection (else track) ±1' },
      { keys: '⌘ ⇧ − / =', label: 'transpose ±1 octave' },
      { keys: '⌘Z / ⇧⌘Z', label: 'undo / redo' },
    ],
  },
  {
    title: 'Tracks & lanes',
    rows: [
      { keys: 'Ctrl =', label: 'add track to the right' },
      { keys: '⌘ D', label: 'duplicate track' },
      { keys: 'Ctrl ⌫', label: 'delete track' },
      { keys: 'Ctrl , / .', label: 'move track left / right' },
      { keys: 'Ctrl ↑ / ↓', label: 'rotate track rows up / down' },
      { keys: 'Ctrl L', label: 'add effect lane' },
      { keys: 'Ctrl K', label: 'remove last effect lane' },
      { keys: 'Track header', label: 'instrument, + lane, × remove lane' },
    ],
  },
  {
    title: 'Playback',
    rows: [
      { keys: 'Space', label: 'play / stop (from cursor)' },
      { keys: 'Ctrl Space', label: 'play from top' },
      { keys: 'Tab', label: 'cycle song / section / pattern' },
      { keys: 'Ctrl F', label: 'follow playhead on / off' },
      { keys: 'Esc', label: 'panic (silence everything)' },
      { keys: 'F1 … F12', label: 'mute track 1 … 12' },
      { keys: '⇧ F1 … F12', label: 'solo track 1 … 12' },
    ],
  },
  {
    title: 'Pattern & song',
    rows: [
      { keys: 'Ctrl N', label: 'new pattern from selection' },
      { keys: 'Click step', label: 'make it the current step' },
      { keys: '⧉ on a step', label: 'make unique (own copy of a repeat)' },
      { keys: 'Double-click', label: 'rename pattern (header)' },
      { keys: 'rows − / +', label: 'pattern length (⇧ ±4)' },
      { keys: 'step − / +', label: 'edit step' },
      { keys: '⌘S / ⇧⌘S', label: 'save / save as' },
      { keys: '⌘O', label: 'open song' },
    ],
  },
]

function Section({ title, rows }: Group) {
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
    <div className="legend">
      <p className="legend-note">⌘ also works as Ctrl, except ⌘ ↑/↓ and ⌘ (⇧) −/= (Ctrl has its own meaning there).</p>
      {GROUPS.map((g) => <Section key={g.title} {...g} />)}
    </div>
  )
}
