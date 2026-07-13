# Modular instruments + visual (React Flow) editor

## Context

synthor today has exactly one instrument kind — a hard-coded saw voice
(`blepsaw → adsr → mul` in `src/engine/instruments.ts`) — and instruments are
created/destroyed 1:1 with tracks inside `docStore`. The user wants a real
**modular synth**: an instrument you build from blocks (oscillators, filters,
envelopes, mixers, …) wired output→input, with knobs to tweak each block and
each connection, edited in a visual node graph (React Flow). They also want a
panel to **add / remove / edit instruments** as first-class, reusable entities.

This maps directly onto the architecture's documented "unifying idea": *an
instrument is a node factory `(freq, gate, params) => node`*. We make that
factory **data-driven** — its internals become a serializable graph of modules —
without disturbing the five-layer separation. `renderInstrument` stays the
single seam; the tracker never learns what's inside an instrument.

**Decisions (confirmed with user):**
- Instruments become **first-class, shared** entities. Tracks reference one via a
  picker; removing a track no longer deletes its instrument.
- The editor is a **full-screen view toggle** (Tracker ⇄ Instruments) so the
  React Flow canvas gets the whole window.
- v1 module palette: **Note, Gate, Oscillator, Filter, ADSR, Gain, Mix, Output**.
  Graphs are **acyclic** (DAG) in v1; feedback/delay/EQ/LFO/distortion are
  additive later (one registry entry + one compile case each).

## Data model (domain — additive, no schema bump)

`Instrument.kind` is already a union, so adding `'modular'` is purely additive;
existing v1 song files with `kind:'osc'` keep loading (`assertShape` in
`serialize.ts` only checks `doc.entities` exists). Keep
`CURRENT_SCHEMA_VERSION = 1`; leave a comment noting modular instruments arrived
without a shape break.

### `src/domain/types.ts` — add
```ts
export interface Port { moduleId: Id; port: string }

export interface Module {
  id: Id
  type: ModuleType          // 'note'|'gate'|'osc'|'filter'|'adsr'|'gain'|'mix'|'output'
  params: Record<string, number>
  pos: { x: number; y: number }   // React Flow layout, persisted
}
export interface Connection {
  id: Id
  from: Port                // source module + outlet
  to: Port                  // target module + inlet
  gain: number              // per-cord "impact" knob (default 1)
}
export interface ModularInstrument {
  id: Id; kind: 'modular'; name: string
  modules: Record<Id, Module>
  connections: Record<Id, Connection>
  outputId: Id              // module whose input feeds the voice
}
export type Instrument = OscInstrument | ModularInstrument   // OscInstrument = today's shape
```

### `src/domain/moduleDefs.ts` — NEW, pure registry (no `el`, no React)
One entry per `ModuleType` describing what the engine and UI both need:
- `label`, `inlets: string[]`, `outlets: string[]`
- `params: { key; label; min; max; default; step }[]`

Consumed by: the compiler (input gathering), the factory (seeding defaults), and
the React Flow node component (rendering sliders + handles). This is the single
place a new module type is declared.

## Engine (pure, unit-testable)

### `src/engine/modular.ts` — NEW
`compileModular(inst: ModularInstrument, freq, gate): NodeRepr_t` — memoised
depth-first evaluation starting from `inst.outputId`:
- For each module, gather each inlet as the **sum of `evalModule(conn.from) *
  conn.gain`** over connections targeting that inlet.
- `note` → `freq`; `gate` → `gate` (the track's control signals become sources).
- `osc` → `el.blepsaw/blepsquare/bleptriangle/cycle` selected by a `waveform`
  param, freq from inlet (× detune); `filter` → `el.svf` (lp/hp/bp by `mode`
  param, `cutoff`+`q`); `adsr` → `el.adsr(a,d,s,r, gateInlet)`; `gain` → `el.mul`;
  `mix` → `el.add`/`el.mul` reduce by `mode` param; `output` → passthrough of its
  inlet.
- **Cycle guard:** a `visiting` set; a back-edge returns `el.const({value:0})`
  (v1 is acyclic — the editor also prevents creating cycles).
- **Reconciliation:** give stateful primitives an explicit key
  `` `${inst.id}:${m.id}` `` (osc phase, `svf`, `adsr`) so editing one param
  doesn't reset another module's state. Mirrors the existing `seq2` keying in
  `compile.ts`.
- Empty/invalid graph → `el.const({value:0})`.

### `src/engine/instruments.ts` — dispatch on kind
`renderInstrument` switches: `'osc'` → existing code unchanged; `'modular'` →
`compileModular(inst, freq, gate)`. `compile.ts` is untouched (it already calls
`renderInstrument` per voice).

### `src/domain/factory.ts` — add
- `newModularInstrument(name)` seeding a **default patch that makes sound
  immediately**: Note→Osc→Filter→Gain, Gate→ADSR→(Gain mod), Gain→Output, with
  sensible `pos` for each node.
- `cloneInstrument(inst)` — deep-clone with **fresh module/connection ids**
  (remap `outputId` and all `Port.moduleId`). Used by duplicate/paste.

## State (`src/state/docStore.ts`)

Instruments become first-class. Add:
- `addInstrument(kind)`, `removeInstrument(id)` (guard: reassign or block if any
  track references it — surface a soft error rather than orphaning tracks),
  `renameInstrument(id, name)`, `setInstrumentParam` / osc gain edits.
- `setTrackInstrument(trackId, instrumentId)` — bind a track to any instrument.
- Modular graph ops (all via `mutate`, so undo/redo + autosave are free):
  `addModule(instId, type, pos)`, `removeModule`, `moveModule(instId, id, pos)`,
  `setModuleParam`, `addConnection`, `removeConnection`, `setConnectionGain`.

**Lifecycle change:** `removeTrack` **no longer** garbage-collects the
instrument (instruments are independent now). `duplicateTrack` references the
**same** instrumentId (true reuse). `copyTrack`/`pasteTrack` keep snapshotting
the instrument and recreate it on paste via `cloneInstrument` (safe across
songs). `addTrack` still binds a fresh osc instrument by default. Update the
`TrackSnapshot` type to carry a full `Instrument` (osc or modular).

## UI

### `@xyflow/react@^12.11` (React 19-compatible) — the one new dependency
Import its stylesheet once. React Flow is *only an editor* over domain data:
nodes/edges are derived from `inst.modules`/`inst.connections`; user gestures
call the docStore mutations above. Node positions persist via `moveModule`.

- `src/App.tsx` — add a `view: 'tracker' | 'instruments'` toggle in the header;
  render `<TrackerGrid>` or `<InstrumentsView>`. Guard the global keydown handler
  so tracker keys are inert in the instruments view.
- `src/ui/InstrumentsView.tsx` — NEW. Left rail = instrument list (add osc / add
  modular / rename / remove / select). Main = editor for the selected
  instrument: osc → simple knob strip; modular → `<ModularEditor>`.
- `src/ui/ModularEditor.tsx` — NEW. `<ReactFlow>` with a single custom node type
  driven by `moduleDefs` (renders inlet/outlet `<Handle>`s + a slider per param).
  `onConnect` → `addConnection`; `onNodesChange` (position) → `moveModule`; edge
  click → inspector with the `gain` slider + delete; a palette to drop new
  modules. Selected-instrument id kept in `InstrumentsView` local state.
- `src/ui/TrackerGrid.tsx` — track header gains an instrument `<select>` bound to
  `setTrackInstrument` (keep it out of the global-keydown path via the existing
  `isEditableTarget` guard).
- `src/styles.css` — panel/list/canvas styling using existing CSS vars
  (`--panel`, `--accent`, …); scope React Flow's dark look to match.

## Files touched
- New: `src/domain/moduleDefs.ts`, `src/engine/modular.ts`,
  `src/ui/InstrumentsView.tsx`, `src/ui/ModularEditor.tsx` (+ optional
  `ModuleNode.tsx`).
- Edit: `src/domain/types.ts`, `src/domain/factory.ts`,
  `src/engine/instruments.ts`, `src/state/docStore.ts`, `src/App.tsx`,
  `src/ui/TrackerGrid.tsx`, `src/styles.css`, `package.json`,
  `src/persist/serialize.ts` (comment only).

## Tests (Vitest — match existing `engine/*.test.ts`, `docStore.test.ts` style)
- `src/engine/modular.test.ts` — compile a hand-built patch; assert node shape /
  no throw; cycle guard returns silence; empty graph → const 0; param change
  keeps keys stable.
- Extend `docStore.test.ts` — instrument CRUD, module/connection ops undo/redo,
  `removeTrack` keeps instrument, `cloneInstrument` produces fresh ids.
- Round-trip a modular instrument through `serialize.ts` (add to
  `serialize.test.ts`) to prove persistence + back-compat with v1 osc files.

## Verification (end-to-end)
1. `npm run typecheck` and `npm test` green.
2. `npm run dev`, open the app, switch to the **Instruments** view.
3. Add a modular instrument → confirm the seeded patch renders in React Flow.
4. Bind a track to it in the tracker header; hit play → hear the modular voice.
5. While playing: drag a Filter's cutoff slider and an edge's gain → sound
   changes live (Elementary reconciles). Add/remove a module and rewire.
6. Undo/redo a module edit; confirm the graph and audio revert.
7. Save, reload the song (OPFS autosave) → the modular patch persists; also load
   a pre-existing osc-only song to confirm back-compat.
8. Drive the real app for the audio checks (per the repo's run/verify skills), not
   just unit tests.
