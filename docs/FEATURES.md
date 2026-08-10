# synthor — Feature Candidates

> A menu of what we could build next. Pick against the [vision](./VISION.md),
> not against this list. Organised by impact-to-effort ratio; no ordering
> within a tier. Each candidate names its prerequisites.

---

## Tier 1 — High impact, low effort

### Solo per track

Complement to mute. `Shift+F1..F12` solos a track (mutes all others). A second
press restores the previous mute state. Or: shift+click a mute indicator.

**Prerequisites:** None — `mutedTracks` in docStore, just needs toggle logic.
**Classic lineage:** FastTracker 2, Renoise.

---

## Tier 2 — Medium effort, big feel

### Interpolation

Select a range of cells in one column, run "interpolate" → linear fill between
the first and last value. Classic for volume fades, pitch bends, and effect
ramps. Would work across note, volume, and effect columns.

**Prerequisites:** Rectangular selection (already done).
**Classic lineage:** Impulse Tracker "interpolate" function.

---

### Block transpose

Select a region of notes, transpose by N semitones. You already have `Cmd±`
for ±1 semitone on a selection. A quick dialog or repeatable key combo for
larger jumps (e.g., ±12 for octave).

**Prerequisites:** Rectangular selection (already done).
**Classic lineage:** All trackers; Impulse Tracker had Alt+F1..F12 for preset
transpose amounts.

---

### Follow mode

A toggle that keeps the playhead row visible during playback — the grid
auto-scrolls so you always see where the music is. Navigating away from the
playhead temporarily disables follow (like a modern IDE's "auto-scroll from
source" toggle).

**Prerequisites:** None — purely a UI scroll behavior.
**Classic lineage:** FastTracker 2, Renoise, most tracker-inspired DAWs.

---

### Render to WAV

Offline bounce the compiled graph to a WAV file. `@elemaudio/offline-renderer`
is already a devDependency. The engine is a pure function `compileGraph(doc, ctx) → StereoOut` — this is mostly wiring, a duration calculator, and a
progress UI. Could render a single pattern or a full song arrangement.

**Prerequisites:** Song playback mode (to render full songs). For single
patterns: none.
**Classic lineage:** Impulse Tracker "Save as WAV", Renoise "Render to disk".

---

### Song playback mode

Play through `sectionIds` → each section's `patternIds` in sequence, rather
than looping a single pattern. The transport would track the current section
index + pattern index and advance on each pattern boundary (loop-reset edge).
The engine needs the current pattern to change dynamically during a play
session — currently it renders one pattern per `compileGraph` call.

**Prerequisites:** Sustained notes + effect columns will make this more
musically useful.
**Classic lineage:** Every tracker with a pattern order list.

---

## Tier 3 — Larger builds, transformative

### Sample editor

Waveform display with zoom, scroll, and loop-point markers. Classic features:
- Sustain and release loop points with crossfade
- Trim / crop / silence
- Normalize, amplify, fade in/out
- Reverse
- Resample (change rate)

Canvas-based React component. Preview playback via a temporary Elementary
graph or Web Audio API `AudioBufferSourceNode`.

**Prerequisites:** Sample library (done).
**Classic lineage:** FastTracker 2 had an excellent built-in sample editor;
Impulse Tracker's was even more capable.

---

### MIDI input

Record notes from an external MIDI controller via the Web MIDI API
(well-supported in Chromium). Two modes:
- **Step record:** each note-on advances the cursor one row (like typing notes
  on the keyboard, but from a controller)
- **Live record:** notes land on the row the playhead is currently at

Velocity maps to the volume column. MIDI device selector in the toolbar.

**Prerequisites:** None (Web MIDI is independent of the engine).
**Classic lineage:** Impulse Tracker had MIDI input for recording + playback.

---

### NNA — New Note Actions

Per-instrument setting for what happens when a new note fires on a track
while the previous voice is still sounding:
- **Cut** — instant stop (current behavior)
- **Continue** — overlap both voices (polyphony on one track)
- **Note Off** — trigger the ADSR release phase of the old voice
- **Fade** — volume ramp down over N ms

Important for realistic monophonic instrument behavior (especially with
sustained notes + release tails).

**Prerequisites:** Sustained notes (the gate-hold behavior).
**Classic lineage:** Impulse Tracker, Renoise.

---

### Groove / swing patterns

A table of per-row timing offsets applied to the clock. Beyond simple BPM —
each row can be slightly early or late. Enables shuffle/swing feels that
can't be expressed with evenly-spaced rows. Would be a document-level
setting (one groove table shared by all patterns) or per-pattern.

**Prerequisites:** In-graph clock would need per-row rate modulation.
**Classic lineage:** Impulse Tracker had a groove table; Renoise has
per-track delay + groove patterns.

---

## Tier 4 — Polish & workflow

These are small, self-contained improvements that add up to a smoother
editing experience.

- **BPM / LPB in toolbar as editable fields** — click to type a value,
  not just display.
- **Pattern-loop during editing** — loop a subsection (e.g. rows 0-15)
  while editing, without changing the full pattern. Transport-only.
- **Track delay** — per-track offset in milliseconds for groove (shifts
  one track slightly ahead or behind the rest).
- **Undo history panel** — show the undo stack so you can see what you're
  undoing and jump to a specific state.
- **Clipboard indicator** — show when a track or rect is on the clipboard;
  reduces confusion when paste does nothing.
- **Dark/light theme** — CSS custom properties; the tracker look benefits
  from a dark background with bright text (like every classic tracker).
- **"New pattern from selection"** — select a region, promote it to a new
  pattern.
- **Ghost channels** — faintly show the previous/next pattern's notes in
  the grid while editing, for context across pattern boundaries.
- **Per-track panning** — a pan slider per track header. The engine already
  supports stereo per drumkit slot; extending it to tracks is a small
  addition.

---

## Deferred by design (from original plan)

These are intentionally deferred — the architecture allows for them, but
they're not urgent:

- **Linked project folder** via File System Access API (Chromium only).
  OPFS works everywhere without permissions; FSA would be an additional
  save/load path for power users who want filesystem access.
- **Zip export round-trip for samples** — currently song JSON exports can
  include samples via `.synthor` zip format. Extending this to a full
  project folder export (with samples as loose files) would mirror the
  OPFS layout on disk.
- **`el.snapshot` phase tap** for sample-accurate playhead position.
  The current `performance.now()`-based playhead is reliable in practice;
  a snapshot tap would make it sample-accurate. Only matters if we add
  features that need frame-precise visual sync (like an oscilloscope).
- **Per-inlet fan-in UI** for the modular editor — currently one cord per
  inlet (replace on connect). A mixer widget for multi-source inputs would
  be needed for complex patches.
