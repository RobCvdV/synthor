# synthor

A modular, web-based tracker synth built on [Elementary Audio](https://www.elementary.audio/).

## Status

Single-pattern tracker with multi-track editing, three instrument types
(oscillator, modular synth, drumkit), sample library, OPFS persistence with
autosave, and a section/pattern song-arrangement model. Playback is in-graph
via `el.seq2` sequencers with sample-accurate timing. Editing is keyboard-driven
with undo/redo, rectangular selection, and track operations.

Next up: effect columns, sustained notes, and song arrangement playback —
see [docs/FEATURES.md](docs/FEATURES.md) for the full candidate list.

## Architecture

Five decoupled layers (bottom to top):

| Layer | Path | Responsibility |
|---|---|---|
| Domain | `src/domain/` | Pure, serializable, normalized data model |
| State | `src/state/` | Zustand stores — document (undoable) + transport (transient) |
| Engine | `src/engine/` | Pure `compile(doc, ctx) → Elementary node` graph compiler |
| Audio | `src/audio/` | AudioContext + Elementary WebRenderer host |
| UI | `src/ui/` | React tracker grid + keyboard handling |

The **engine is a pure function** with no React/Zustand/AudioContext imports,
so it is unit-testable and reusable for offline bounce or headless playback.
Sequencing is **in-graph**: a global `el.train` clock steps per-track `el.seq2`
sequencers — sample-accurate timing for free, and edits-while-playing reconcile
automatically.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest (engine + store logic)
npm run typecheck  # tsc --noEmit
```

## Views

Toggle between three views via the toolbar:

| View | What it is |
|------|-----------|
| **Tracker** | The pattern grid — notes, volume, keyboard editing |
| **Instruments** | Instrument list + editor (osc params, modular graph, drumkit mapping) |
| **Samples** | Sample library — import, preview, rename, delete |

## Keys

### Transport

| Keys | Action |
|------|--------|
| `Space` | Play / stop (from cursor) |
| `Ctrl Space` | Play from top |
| `↑ ↓` | Move row |
| `← →` | Note ↔ volume column, next/prev track |
| `⇧ arrows` | Select region |
| `⌥ ↑/↓` | Jump 4 rows (snap to grid) |
| `⌘ ↑/↓` | Jump 8 rows (snap to grid) |
| `Home / End` | Top / bottom |
| `⌘Z / ⌘⇧Z` | Undo / redo |

### Note entry

| Keys | Action |
|------|--------|
| `Z … M` | Notes (lower octave) |
| `Q … U` | Notes (upper octave) |
| `S D G H J …` | Sharps (lower) |
| `2 3 5 6 7 …` | Sharps (upper) |
| `− / =` | Octave down / up |
| `` ` `` | Note-off (toggle) |
| `[ / ]` | Volume down / up |
| `Del / ⌫` | Clear cell |
| `0-9, A-F` | Hex volume entry (in volume column) |

### Track operations (Ctrl)

| Keys | Action |
|------|--------|
| `Ctrl =` | Add track to right |
| `Ctrl , / .` | Move track left / right |
| `Ctrl C / X / V` | Copy / cut / paste |
| `Ctrl D` | Duplicate track |
| `Ctrl ⌫` | Delete track |
| `Ctrl ↑ / ↓` | Shift notes up / down |

### Mute

| Keys | Action |
|------|--------|
| `F1 … F12` | Mute track 1 … 12 |

## Known simplifications

- **Playhead** is derived from the AudioContext clock (visual approximation).
  Precise in practice after the sync work of July '26; will eventually be
  replaced by an `el.snapshot` tap on the sequencer phase.
- **No effect columns yet** — the data model has room for them (note + volume
  columns are implemented), but per-row effects (portamento, vibrato, arpeggio,
  etc.) are the next major feature.
- **One-row gates** — each note only sounds for its own row. Sustained notes
  (gate held across empty rows until note-off) are planned.
- **Song playback** — sections and patterns can be arranged in the SongBar,
  but playback only loops the current pattern. Sequential song playback is
  planned.
