# synthor — Roadmap & Progress

> Living log: what's done, what's next. Pair with [VISION.md](./VISION.md).
> Feature candidates are detailed in [FEATURES.md](./FEATURES.md).
> Newest progress at the top of "Done".

## Done

### M5 — Song playback, effect lanes, mixer, sample editor (Aug 2026)
- **Effect columns**: per-row lanes — vibrato rate/depth, tremolo rate/depth,
  portamento, volume slide, panning, staccato — plus **named inlets**: tracks
  drive named parameters of a modular instrument straight from the grid.
  Ctrl+L/K to add/remove lanes; two-hex-digit lane entry.
- **Sustained notes**: hold chains (`\`) keep the gate open across rows;
  volume/staccato shape the tail; release phase matches keyboard note-off.
- **Song/section playback**: patterns → sections → songs, played in sequence
  through the scheduler-worklet arrangement. Pattern / Section / Song modes
  (Tab cycles). Playhead maps global arrangement rows to the current pattern.
- **Mixer**: sub channels + master strip — volume, balance, mute/solo, effect
  chains (echo, reverb, convolution, compression, stereo width, …), master
  level meter.
- **Sample editor**: waveform view with cut/copy/paste edits, waveform
  generator, save-as and export.
- **Global performance state** (appStore, persisted): track mutes/solos keyed
  by Track # (apply across all patterns, survive refresh), one global keyboard
  octave, a global keyboard instrument (header dropdown; note keys work on
  tracker, instruments, samples, and mixer), and a global PANIC button.
  Shared `KeyboardPlayer` (audio/keyboardPlayer.ts) handles held notes
  app-wide.
- **MIDI live playback**: Web MIDI input, per-channel instrument routing,
  CC bindings (learn mode), active instrument follows the tracker cursor.
- **Pattern duplication**, **tap tempo**, **editable BPM** in the toolbar.

### Sync & playhead fixes (July 2026)
- **Precise playhead-audio sync**: render-time `playStartTime` capture per
  play-epoch, eliminating the rAF gap between keypress and graph render.
- **Play-from-cursor** (Space) and **play-from-top** (Ctrl+Space).
- **Fresh clock train per play-epoch**: unique rate node key forces a new
  `el.train` at phase 0, eliminating pause/resume clock-phase drift.
- **Grid-snap arrow jumps**: ⌥↑/↓ snaps to multiples of 4, ⌘↑/↓ to multiples
  of 8. Handles non-multiple pattern lengths correctly.
- **Pattern length ±1** (Shift+click for ±4). Prevents unreachable lengths.

### M4 — Instruments & modular synth
- **Three instrument types**: `OscInstrument` (saw + gain), `ModularInstrument`
  (node-graph synth), `DrumKitInstrument` (key-mapped slots with inheritance).
- **Modular editor** (`ModularEditor.tsx`): React Flow node-graph editor.
  Palette: note/gate/volume sources, osc (5 waveforms), filter (lp/hp/bp with
  cutoff modulation), ADSR, gain (level + mod inlet), mix (add/multiply, 4
  inputs), LFO (5 waveforms, gate-sync), tanh (distortion), delay (single-tap),
  echo (feedback), reverb (multi-comb stereo), sample player, output (clip LED
  + waveform scope).
- **Drumkit editor** (`DrumKitEditor.tsx`): piano-roll key mapping UI,
  sample or instrument per slot, per-slot pitch/gain/pan, key range selectors.
- **Live keyboard preview**: audition instruments while stopped. Polyphonic,
  per-note voices with release tail GC.
- **Sample library** (`SampleLibraryView.tsx`): import audio files (WAV, etc.),
  auto-hash for content-addressed OPFS storage, rename, delete. Samples
  load into Elementary's VFS for playback.
- **First-class instruments**: tracks reference instruments by id; multiple
  tracks can share one instrument. `duplicateTrack` shares the ref;
  copy/paste clones via `factory.cloneInstrument`.
- **Instruments are reusable across patterns** — normalized entity map,
  never copied.

### M3 — Song persistence (JSON + autosave)
- **Versioned `SongFile`** (`persist/serialize.ts`): `schemaVersion` + meta +
  doc, with a migration chain (v1→v2→v3→v4). Pure/round-trip tested.
- **OPFS working store** (`persist/opfsStore.ts`): songs saved as
  `songs/<slug>/song.json`. Always-available, no permission prompt.
- **Debounced, coalescing autosave** (`persist/autosave.ts` +
  `ui/useAutosave.ts`): saves ~800ms after edits settle, flushes on transport
  stop / tab hide / unload.
- **Zip export/import** (`.synthor` format via `fflate`) with sample binaries;
  JSON-only export for lightweight sharing. UI lives in the tracker's right
  pane. (The original `ProjectBar` was superseded by the toolbar + right-pane
  layout.)
- **Recent-song tracking**: restores the last-opened song on startup.
- **Song rename** moves the OPFS directory (including samples).
- **id scheme**: `makeId` uses `crypto.randomUUID()` so post-load ids can't
  collide.

### M2.2 — Editing & track operations
- **Volume column**: per-cell hex volume entry (two-digit `00`–`FF`),
  bracket adjust (`[`/`]`), wired into the audio path for all instrument
  types.
- **Note-off column**: toggle per cell via backtick; mutually exclusive
  with note. (Superseded by hold chains in M5; the field remains as a legacy
  end-of-chain marker.)
- **Rectangular selection**: shift+click or shift+arrows, copy/cut/paste
  across tracks and rows.
- **Track ops**: copy/paste/duplicate/move/remove via Ctrl combos.
  Track clipboard independent of undo history.
- **Shift-selection** extends to new cursor position on navigation.
- **Pattern name editing**: double-click to rename.

### M2.1 — Fixes & polish
- **Ctrl+↑/↓ shift track notes** up/down (wrap-around), undoable.
- **Ctrl+X cut** (to clipboard) vs **Ctrl+⌫ delete** (no clipboard).
- **F1–F12 mute** tracks 1–12 (performance state, not undoable). Muted
  voices are gained to 0 but kept in the graph so sequencer phase is
  preserved. (Rekeyed to Track # and made global/persistent in M5.)
- **Track headers** show track number + instrument selector dropdown.
- **Fixed per-track sequencer phase drift**: shared loop-reset re-zeroes
  all sequencers at pattern boundaries.

### M2 — Richer editing (single pattern)
- **Extended piano keymap**: full two-row classic tracker layout (lower +
  upper octave). Mapped by physical key position (`KeyboardEvent.code`).
  Octave via `-` / `=`.
- **Track operations** (Ctrl combos): insert left/right, move left/right,
  remove, copy, paste, duplicate.
- **On-screen legend** (right side) listing all controls.

### M1 — Vertical slice
Proved the full stack end to end.
- Decoupled layers: domain → state → engine → audio → ui (now eight, with
  player/persist/midi).
- Pure `compile(doc, ctx) → Elementary node` graph compiler.
- In-graph windowed sequencing: global `el.train` clock → per-track `el.seq2`.
  (Superseded by the scheduler worklet in M5.)
- Zustand doc store with Immer patch-based **undo/redo**; separate transport
  store.
- Keyboard-driven grid, spacebar transport, **verified real audio** (RMS
  meter).
- One 16-row pattern, two saw-oscillator tracks.

## Next candidates (unordered — pick against the vision)

See [FEATURES.md](./FEATURES.md) for detailed descriptions of each candidate.
The shortlist:

- **Interpolation** — linear fill between two selected cells.
- **Block transpose** — larger transposition jumps (Cmd± ±1 exists).
- **Follow mode** — auto-scroll grid to keep playhead visible.
- **Render to WAV** — offline bounce via `@elemaudio/offline-renderer`.
- **MIDI recording** — step-record and live-record (live playback exists).
- **NNA** — new-note actions for monophonic behavior.
- **Groove / swing** — per-row timing offsets.
- **Pattern-loop during editing**, **track delay**, **undo panel**,
  **clipboard indicator**, **theme**, **new pattern from selection**,
  **ghost channels**, **per-track panning in the grid**.

## Known simplifications carried forward

- Playhead is a visual approximation from the AudioContext clock (precise in
  practice after sync work; `el.snapshot` tap deferred).
- Shared voice slots across pattern windows: a Track-# mute on a contested
  slot is static — the currently visible pattern wins.
- No offline WAV render — export is `.synthor` zip or JSON.
- MIDI is playback-only — no recording.
- No linked project folder (File System Access API) — OPFS works everywhere
  without permissions; FSA would be an additional path for power users.
