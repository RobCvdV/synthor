# synthor — Vision

> This is the north star. It captures the original idea as described by Rob.
> We revisit it regularly to check direction and pick the next step. Keep it
> stable — record *what we're building toward*, not implementation detail
> (that lives in [ROADMAP.md](./ROADMAP.md) and the code).

> **Status vs vision (Aug 2026):** the core of this vision is built — the
> tracker grid drives notes, volumes, effect lanes, and named inlets of
> modular instruments; patterns/sections/songs arrange and play in sequence.
> What's left is mostly depth: recording, offline render, and polish (see
> [FEATURES.md](./FEATURES.md)).

## The one-liner

A modular, web-based **tracker** synth — the tracker editor/player of 2–3
decades ago, rebuilt on steroids. Audio powered by
[Elementary Audio](https://www.elementary.audio/); UI on the web.

## Core structure

- **Cell / row / track**: a track is a vertical lane of steps. Each step can
  hold a **note**, a **volume**, and an **effect** (note / vol / eff columns).
- **Pattern**: contains any number of tracks; the **pattern defines the length**
  of all its tracks. Rich editing: move / copy / paste / duplicate selections
  of a track or across tracks; create a new pattern from a selection; **undo**.
- **Section**: a reusable arrangement of patterns.
- **Song**: a reusable arrangement of sections.
- Everything reusable — patterns → sections → song.

## Editing & navigation

- Move up/down through track positions to edit a melody or drum line.
- Move easily between **note / vol / eff** and switch tracks with a key combo.
- Toggle between **following the player position** vertically while playing vs
  **moving freely** around while the player keeps playing.
- Quick player controls: **play**, **pause (space)**, jump to start of track,
  **play from here**, **play from start** (of pattern / section / … depending
  on loop mode).
- Shortcuts to jump to start / quarter / half / three-quarter of a pattern.

## Effects

Effects in a track can affect:
- **Pitch**: bend, modulate, finetune
- **Volume**: tremolo/lesly, fade in, fade out
- **Instrument inputs**: EQ, filters, envelope, delay, anything
- …and anything else we think of.

> Realized as **effect lanes** (vibrato, tremolo, portamento, volume slide,
> panning, staccato) plus **named inlets** — the grid drives arbitrary
> parameters of modular instruments. More lane types are candidate features.

## Instruments

- Simplest: **oscillator synths** and **sample players**, with (partial) loop
  option, envelope, main volume out. (Today: oscillator + modular instruments,
  with sample/wave/conv modules inside the modular editor.)
- A **drumkit** instrument: several sounds/instruments mapped under keys/notes —
  mostly samples, but synths allowed too. (Realized — per-slot sample *or*
  instrument, with inheritance and key ranges.)

## The "on steroids" / modular goal

The big goal: instruments can be **modular synths**, and tracks can control the
**inputs of a modular instrument** instead of just triggering one note. That
yields a **modular tracker synth** — the same tracker grid drives arbitrary
parameters of arbitrary patches.

> Realized: the modular editor builds arbitrary patches, and tracks drive them
> through named inlet lanes on the grid — one lane per patch input.

## Foundational choices

- **Flexible & modular**: every part reusable.
- **Elementary Audio** for all audio (web-capable, declarative DSP).
- Web-based UI, with **state management + storage** (Zustand-style store).

## Guiding principle for how we build

Build in **practical, useful** increments. After each step, look back at this
vision, review what's done, and choose the best next step together.
