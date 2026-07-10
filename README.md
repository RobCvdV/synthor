# synthor

A modular, web-based tracker synth built on [Elementary Audio](https://www.elementary.audio/).

## Status

Vertical slice: one pattern, two saw-oscillator tracks, in-graph windowed
sequencing, keyboard-driven grid editing with undo/redo, spacebar transport.

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

## Keys

- `space` — play / stop (also boots audio)
- `z`–`m` — enter notes (one octave, C on `z`)
- `[` / `]` — octave down / up
- arrows — move cursor
- `delete` / `backspace` — clear cell
- `⌘Z` / `⌘⇧Z` — undo / redo

## Known slice simplifications

- Playhead is derived from the AudioContext clock (visual approximation) —
  will be replaced by an `el.snapshot` tap on the sequencer phase.
- One-row (staccato) gates; no note-off / vol / effect lanes yet.
- No sections/song arrangement or persistence yet (model is ready for both).
