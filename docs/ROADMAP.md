# synthor — Roadmap & Progress

> Living log: what's done, what's next. Pair with [VISION.md](./VISION.md).
> Newest progress at the top of "Done".

## Done

### M3 — Song persistence (JSON + autosave)
- **Versioned `SongFile`** (`persist/serialize.ts`): `schemaVersion` + meta + doc,
  with a `migrate` hook so older files keep loading. Pure/round-trip tested.
- **OPFS working store** (`persist/opfsStore.ts`): songs saved as
  `songs/<slug>/song.json`, mirroring the eventual project-folder + `samples/`
  layout. Always-available, no permission prompt; degrades gracefully where
  unsupported.
- **Debounced, coalescing autosave** (`persist/autosave.ts` + `ui/useAutosave.ts`):
  saves ~800ms after edits settle, flushes on transport stop / tab hide /
  unload. Safe during playback (small JSON, off the audio thread) — timing, not
  play-state, is the throttle. One save in flight at a time; no lost edits.
- **`ProjectBar`**: song name, save-status indicator, New / Open / Save /
  Export (`.synthor.json`) / Import / Delete.
- **id scheme fix**: `makeId` now uses `crypto.randomUUID()` so ids created
  after loading a saved song can't collide with loaded ones.
- Deferred (design allows for, not built yet): real File System Access folder,
  zip export, and the `samples/` binary asset store — all land when the
  sample-player instrument and sections/song arrangement arrive (schema v2).

### M1 — Vertical slice (commit `b173e01`)
Proved the full stack end to end.
- Five decoupled layers: domain → state → engine → audio → ui.
- Pure `compile(doc, ctx) → Elementary node` graph compiler.
- In-graph windowed sequencing: global `el.train` clock → per-track `el.seq2`.
- Zustand doc store with Immer patch-based **undo/redo**; separate transport store.
- Keyboard-driven grid, spacebar transport, **verified real audio** (RMS meter).
- One 16-row pattern, two saw-oscillator tracks.

### M2.1 — Fixes & polish
- **Ctrl+↑/↓ shift track notes** up/down (wrap-around), undoable.
- **Ctrl+X cut** (to pasteboard) vs **Ctrl+⌫ delete** (no pasteboard).
- **F1–F12 mute** tracks 1–12 (performance state, not undoable). Muted voices
  are gained to 0 but kept in the graph so sequencer phase is preserved across
  mute/unmute.
- **Track headers** show the track number above the instrument name; names are
  cropped to the track width (a `--track-w` CSS var that grows with vol/eff).
- **Fixed per-track sequencer phase drift**: each `el.seq2` counter starts at 0
  on node creation, so a track added mid-playback (duplicate/paste/insert) drifted
  out of phase. Now a single shared loop-reset (`el.train`) re-zeroes every
  sequencer at each pattern boundary → tracks stay mutually aligned. Guarded by
  graph-introspection tests that fail if the shared reset regresses.

### M2 — Richer editing (single pattern)
- **Extended piano keymap**: full two-row classic tracker layout (lower + upper
  octave), playable without a MIDI keyboard. Mapped by physical key position
  (`KeyboardEvent.code`) to stay keyboard-layout-robust. Octave via `-` / `=`.
- **Track operations** (Ctrl combos): insert left / insert right / move left /
  move right / remove (cut) / copy / paste / duplicate, with clipboard kept out
  of undo history.
- **On-screen legend** (right side) listing all editing controls.

## Next candidates (unordered — pick against the vision)

- Sustained notes + real **note-off** (replace one-row staccato gates).
- **vol** and **eff** columns per step; cursor moves across note/vol/eff.
- **Selection** + block move/copy/paste/duplicate across rows and tracks.
- **Sections → song** arrangement layer (model already normalized for it);
  bump SongFile to schema v2 with a migration when it lands.
- Sample-player instrument; **drumkit** instrument. Adds the `samples/` binary
  asset store (content-addressed) alongside `song.json`.
- **Linked project folder** via File System Access API (Chromium) + zip
  export, reusing the OPFS folder layout.
- Follow-playhead vs free-move toggle; jump to ¼/½/¾ of pattern; play-from-here.
- Fidelity: replace approximate playhead with an `el.snapshot` tap.

## Known simplifications carried forward

- Playhead is a visual approximation from the AudioContext clock.
- One-row (staccato) gates; no note-off yet.
- No sections/song arrangement yet (persistence shipped in M3, schema v1).
