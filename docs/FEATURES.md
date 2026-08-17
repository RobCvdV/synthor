# synthor — Feature Candidates

> A menu of what we could build next. Pick against the [vision](./VISION.md),
> not against this list. Organised by impact-to-effort ratio; no ordering
> within a tier. Each candidate names its prerequisites.
>
> Implemented candidates move to [ROADMAP.md](./ROADMAP.md) / the README;
> remove them from this file when they land.

---

## Tier 1 — High impact, low effort

### Interpolation

Select a range of cells in one column, run "interpolate" → linear fill between
the first and last value. Classic for volume fades, pitch bends, and effect
ramps. Would work across note, volume, and effect columns. Should probably affect only one lane to keep unrelated values untouched.

**Prerequisites:** Rectangular selection (partially done, need lane specific selection).
**Classic lineage:** Impulse Tracker "interpolate" function.

---

## Tier 2 — Medium effort, big feel

### Block transpose (larger jumps)

Select a region of notes, transpose by N semitones. `Cmd±` already transposes
a track or selection by ±1 semitone. A quick dialog or key combo `Cmd+shift+±`
for larger jumps (e.g., ±12 for octave).

**Prerequisites:** Rectangular selection (done).
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
is already a devDependency. The engine is a pure function
`compileGraph(doc, ctx) → StereoOut` — this is mostly wiring, a duration
calculator, and a progress UI. Could render a single pattern or a full song
arrangement. Allow rate and width (eg 48Khz or 41Khz, 24bit or 16bit)

**Prerequisites:** None — song playback mode is done.
**Classic lineage:** Impulse Tracker "Save as WAV", Renoise "Render to disk".

---

### MIDI recording

Live playback from external controllers already works (Web MIDI, per-channel
instrument routing, CC bindings). Recording is the missing half:
- **Step record:** each note-on advances the cursor one row (like typing notes
  on the keyboard, but from a controller)
- **Live record:** notes land on the row the playhead is currently at

Velocity maps to the volume column.
Allow Optional quantization: 1-x rows

**Prerequisites:** None — Web MIDI input is wired and playing.
**Classic lineage:** Impulse Tracker had MIDI input for recording + playback.

---

### Instrument specific visualizers

Now we have an oscilloscope showing in the instruments panel outlet, but it shows the total mix. Make those show the instruments specific audio.
Could be expensive, so if needed, add a toggle to enable it, preferably without recompiling, but else with a recompile.
Cheaper and possibly just as valuable are instrument specific level meters. Also in the mixer page. 
And Sub channel meters are welcome too.

**Prerequisites:** Needs assessment of performance impact.
**Classic lineage:** Most Trackers did this flawlessly.

---

## Tier 3 — Larger builds, transformative

### NNA — New Note Actions

Per-instrument setting for what happens when a new note fires on a track
while the previous voice is still sounding:
- **Cut** — instant stop (current behavior)
- **Continue** — overlap both voices (polyphony on one track)
- **Note Off** — trigger the ADSR release phase of the old voice
- **Fade** — volume ramp down over N ms

Important for realistic monophonic instrument behavior (especially with
sustained notes + release tails).

**Prerequisites:** Sustained notes (done — hold chains exist).
**Classic lineage:** Impulse Tracker, Renoise.

---

### Groove / swing patterns

A table of per-row timing offsets applied to the clock. Beyond simple BPM —
each row can be slightly early or late. Enables shuffle/swing feels that
can't be expressed with evenly-spaced rows. Would be a document-level setting
(one groove table shared by all patterns) or per-pattern.

**Prerequisites:** Per-row timing offsets would live in the scheduler's
per-row signal data rather than the clock itself.
**Classic lineage:** Impulse Tracker had a groove table; Renoise has
per-track delay + groove patterns.

---

## Tier 4 — Polish & workflow

These are small, self-contained improvements that add up to a smoother
editing experience.

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

---

## Deferred by design (from original plan)

These are intentionally deferred — the architecture allows for them, but
they're not urgent:

- **Linked project folder** via File System Access API (Chromium only).
  OPFS works everywhere without permissions; FSA would be an additional
  save/load path for power users who want filesystem access.
- **`el.snapshot` phase tap** for sample-accurate playhead position.
  The current clock-derived playhead is reliable in practice; a snapshot tap
  would make it sample-accurate. Only matters if we add features that need
  frame-precise visual sync (like an oscilloscope).
- **Per-track panning in the grid** — a pan slider per track header. Should be effect-lane controlled
