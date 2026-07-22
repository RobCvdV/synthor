# synthor — Roadmap & Progress

> Living log: what's done, what's next. Pair with [VISION.md](./VISION.md).
> Feature candidates are detailed in [FEATURES.md](./FEATURES.md).
> Newest progress at the top of "Done".

## Done

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
- **`ProjectBar`**: song name, save-status indicator, New / Open / Save /
  Export (`.synthor` zip + `.synthor.json`) / Import / Delete.
- **Recent-song tracking**: restores the last-opened song on startup.
- **Song rename** moves the OPFS directory (including samples).
- **Zip export/import** (`.synthor` format via `fflate`) with sample binaries.
- **id scheme**: `makeId` uses `crypto.randomUUID()` so post-load ids can't
  collide.

### M2.2 — Editing & track operations
- **Volume column**: per-cell hex volume entry (two-digit `00`–`FF`),
  bracket adjust (`[`/`]`), wired into the audio path for all instrument
  types.
- **Note-off column**: toggle per cell via backtick; mutually exclusive
  with note. Data model ready for sustained-note gate behavior.
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
  preserved.
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
- Five decoupled layers: domain → state → engine → audio → ui.
- Pure `compile(doc, ctx) → Elementary node` graph compiler.
- In-graph windowed sequencing: global `el.train` clock → per-track `el.seq2`.
- Zustand doc store with Immer patch-based **undo/redo**; separate transport
  store.
- Keyboard-driven grid, spacebar transport, **verified real audio** (RMS
  meter).
- One 16-row pattern, two saw-oscillator tracks.

## Next candidates (unordered — pick against the vision)

See [FEATURES.md](./FEATURES.md) for detailed descriptions of each candidate.
The shortlist:

- **Effect columns** — per-row commands (arpeggio, portamento, vibrato,
  volume slide, pattern break, etc.). The defining tracker feature.
- **Sustained notes** — gate held across empty rows until note-off or next
  note. The `noteOff` field already exists; needs engine-side gate logic.
- **Song playback mode** — play through sections → patterns sequentially,
  not just loop the current pattern.
- **Pattern duplication** — deep-clone a pattern with all tracks and cells.
- **Solo per track** — complement to mute.
- **Interpolation** — linear fill between two selected cells.
- **Follow mode** — auto-scroll grid to keep playhead visible.
- **Jump to ¼ / ½ / ¾ of pattern** — quick navigation shortcuts.
- **Render to WAV** — offline bounce via `@elemaudio/offline-renderer`.
- **MIDI input** — step-record and live-record from external controllers.
- **Sample editor** — waveform view, loop points, trim, normalize.
- **Tap tempo** — click BPM display to set tempo.

## Known simplifications carried forward

- Playhead is a visual approximation from the AudioContext clock (precise in
  practice after sync work; `el.snapshot` tap deferred).
- One-row (staccato) gates — each note only sounds for its own row.
- No effect columns yet — note + volume columns are implemented.
- Song arrangement editing works; sequential playback is not yet implemented.
- No linked project folder (File System Access API) — OPFS works everywhere
  without permissions; FSA would be an additional path for power users.
