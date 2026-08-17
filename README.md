# synthor

A modular, web-based tracker synth built on [Elementary Audio](https://www.elementary.audio/).
React + TypeScript + Vite + zustand.

## What it does today

- **Tracker grid** with multi-track patterns: note, volume, and effect-lane
  columns (vibrato, tremolo, portamento, volume slide, panning, staccato, plus
  per-instrument **named inlets** that put modular parameters on the grid).
- **Sustained notes** — hold chains (`\`) keep a note's gate open across rows,
  with per-row volume and staccato shaping the tail.
- **Patterns → sections → song**: arrange patterns into sections, sections into
  songs, and play through the full arrangement (Pattern / Section / Song modes).
- **Three instrument types**: oscillator, modular node-graph synth (React Flow
  editor), and drumkit (per-key sample/instrument mapping, key ranges,
  inheritance).
- **Mixer** with sub channels and a master strip: per-channel volume, balance,
  mute/solo, effect chains (echo, reverb, compression, width, …), plus a master
  level meter.
- **Sample library** (content-addressed OPFS storage) and a **sample editor**
  with cut/copy/paste edits and a waveform generator.
- **Live performance state**: track mutes/solos keyed by Track # (global across
  patterns, persisted), a single global keyboard octave, a global keyboard
  instrument (header dropdown, plays on every page incl. the mixer), and a
  global PANIC.
- **MIDI input** — live playback from any attached controller, with per-channel
  instrument routing and CC bindings.
- **Persistence**: undo/redo, debounced autosave to OPFS, song export/import as
  `.synthor` (zip with sample binaries) or `.synthor.json`.

## Architecture

Eight decoupled layers (bottom to top):

| Layer | Path | Responsibility |
|---|---|---|
| Domain | `src/domain/` | Pure, serializable data model (`Doc` + entities), factories, module defs |
| State | `src/state/` | zustand stores: docStore (undoable doc), appStore (persisted UI/performance prefs), transport/midi/preview/project (transient) |
| Engine | `src/engine/` | Pure `compileGraph(doc, ctx) → Elementary nodes` — no React/AudioContext imports |
| Audio | `src/audio/` | `AudioHost` (AudioContext + WebRenderer), `paramRefs`, `KeyboardPlayer` |
| Player | `src/player/` | Scheduler worklet + `SchedulerNode`, `playbackData` (track→slot mapping) |
| UI | `src/ui/` | Views, tracker grid, keymap, `useEngine` (store→host wiring) |
| Persist | `src/persist/` | OPFS autosave/serialize, sample storage, zip export |
| MIDI | `src/midi/` | `useMidi` Web MIDI wiring |

Key mechanisms (see `CLAUDE.md` for the full rules):

- The **engine is a pure function** — unit-testable, reusable for offline
  bounce or headless playback.
- **Playback runs in the audio thread.** The scheduler worklet drives note
  events (gate/freq) straight into Elementary via `el.in`; note edits,
  transport, and BPM changes never recompile the graph. Only structural edits
  do, detected by a `structuralKey` hash in `useEngine`. Four `SchedulerNode`s
  span the browser's 32-channel-per-worklet cap.
- **`paramRefs`** — `createRef`-backed nodes let sliders, mutes, and MIDI CC
  update Elementary live without a recompile.
- **Voice slots** are pre-allocated per instrument (max concurrent tracks in
  any pattern); tracks in non-overlapping pattern windows share slots.
- **docStore** holds the undoable doc (Immer recipes + undo history); only the
  doc autosaves. **appStore** holds persisted UI/performance state (view,
  cursor, octave, Track-# mutes/solos, selected instrument/sample).

## Develop

```bash
npm install
npm run dev        # Vite dev server — HTTPS-only on https://localhost:5173
npm test           # Vitest (engine + store logic)
npm run typecheck  # tsc --noEmit
```

## Views

Toggle via the toolbar (⌘T / ⌘I / ⌘S / ⌘M):

| View | What it is |
|------|-----------|
| **Tracker** | The pattern grid — notes, volume, effect lanes, keyboard editing |
| **Instruments** | Instrument rail + editor (osc params, modular graph, drumkit mapping) |
| **Samples** | Sample library + sample editor (import, preview, waveform edits) |
| **Mixer** | Sub channels + master strip with effect chains |

The toolbar also carries the **global keyboard instrument** dropdown, the
**global note range** (oct − / +), and **PANIC** (cuts every voice, sample
preview, and the transport).

## Keys

The in-app Legend (tracker view, right side) is authoritative; the essentials:

| Keys | Action |
|------|--------|
| `Space` / `Ctrl Space` | Play from cursor / from top |
| `Tab` | Cycle Pattern → Section → Song |
| `↑ ↓ ← →` / `⇧ arrows` | Move cursor / extend selection |
| `⌥ ↑↓` / `⌘ ↑↓` | Jump 4 / 8 rows (grid snap) |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `Z … M` + `Q … U` rows | Notes, two octaves (physical key codes) |
| `− / =` | Octave down / up (global, all views) |
| `\` | Hold — continue the note across rows (shows `\|`) |
| `[ / ]` | Volume adjust on current cell |
| `0-9, A-F` | Hex entry (volume column, effect lanes) |
| `Del / ⌫` | Clear cell / selection |
| `Ctrl =` , `Ctrl , / .` | Add track / move track |
| `Ctrl C / X / V / D / ⌫` | Copy / cut / paste / duplicate / delete track |
| `Ctrl ↑↓` | Shift track notes up / down |
| `Ctrl L / K` | Add / remove effect lane |
| `Cmd/Ctrl − / =` | Transpose track or selection ±1 semitone |
| `F1 … F12` / `⇧F1 … F12` | Mute / solo Track # (global, persists) |

## Known limitations

- **Playhead** is derived from the AudioContext clock — a visual approximation
  (precise in practice; an `el.snapshot` phase tap is deferred).
- **Shared voice slots**: two patterns can map the same (instrument, slot) to
  different track numbers; a Track-# mute on a contested slot is static, and
  the currently visible pattern wins.
- **No offline WAV render** yet — export is the `.synthor` container or JSON.
- **MIDI is playback-only** — no step/live recording yet.

See [docs/VISION.md](docs/VISION.md) for the north star,
[docs/ROADMAP.md](docs/ROADMAP.md) for the progress log, and
[docs/FEATURES.md](docs/FEATURES.md) for what's next.
