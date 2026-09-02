# synthor

Modular web-based tracker synth on Elementary Audio. React + TypeScript + Vite + zustand.

## Commands

- `npm run dev` — dev server, **HTTPS-only** on 5173 (akiar.nl certs; a plain-http probe looks like a dead process)
- `npm test` — vitest (engine/store logic), `npm run test:watch` while iterating
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck + vite build; `npm run deploy` publishes (don't run unasked)

Product intent and planned work live in `docs/` (`VISION`, `FEATURES`, `ROADMAP`) — this file is rules only.

## Layers (bottom → top)

| Layer | Path | Responsibility |
|---|---|---|
| Domain | `src/domain/` | Pure, serializable data model (`Doc`, entities), factories, module defs |
| State | `src/state/` | zustand stores: docStore (undoable doc), appStore (persisted UI prefs), transport/midi/preview/project (transient) |
| Engine | `src/engine/` | Pure `compileGraph(doc, ctx) → Elementary nodes` — no React/AudioContext imports |
| Audio | `src/audio/` | `AudioHost` (AudioContext + WebRenderer), `paramRefs`, `KeyboardPlayer` |
| Player | `src/player/` | `playbackData` (track→slot mapping), `txSeqData` (packing for the native node) |
| Native | `src/native/` | `TxSeq` sequencer + node registration, compiled into the Elementary wasm |
| UI | `src/ui/` | Views, tracker grid, keymap, `useEngine` (store→host wiring) |
| Persist | `src/persist/` | OPFS autosave/serialize, sample storage, export |
| MIDI | `src/midi/` | `useMidi` Web MIDI |

## Where to change what

Chains are ordered; each hop is verified. Skipping the tail is how features half-land.

| Feature request sounds like… | Touch, in order |
|---|---|
| New module type (osc / filter / fx node in the modular editor) | `domain/types.ts` `ModuleType` → `domain/moduleDefs.ts` `MODULE_DEFS` entry (`group` is what puts it in the Add palette) → `engine/modular.ts` `render` case → `persist/serialize.ts` version bump. `ModularEditor` renders from `MODULE_DEFS` — only touch it for a control that isn't a slider |
| New param on an existing module | `domain/moduleDefs.ts` `params` (the slider is automatic) → read it in that module's `engine/modular.ts` case; via `paramRefs` if it must apply without recompiling |
| New effect lane (tracker column) | `domain/effects.ts` (`BUILTIN_LANE_TYPES` + `LANE_DEFS`) → `engine/voiceSlotLayout.ts` channel counts → `player/playbackData.ts` (fill the channel + its neutral default) → `src/native/TxSeq.h`, only if it needs sub-row behaviour → `engine/compile.ts` (txSeq outlet read + apply) → `ui/TrackerGrid.tsx` column |
| New persisted UI preference | `state/appStore.ts`: state + action + **`partialize`** — a key missing from `partialize` silently doesn't persist |
| Transport / BPM / note timing | `state/transportStore.ts` + `player/` — must not cause a recompile |
| New keyboard shortcut | the owning keydown handler: `App.tsx` (global; tracker + mixer) or the view's own (`InstrumentsView`, `SampleLibraryView`, `ModularEditor`, `SampleEditor`). `ui/keymap.ts` is only the note layout |
| Save / load / project format | `persist/serialize.ts`: bump `CURRENT_SCHEMA_VERSION` **and** add the `migrate` case |
| Sample import / edit / storage | `audio/sampleLoader.ts`, `audio/sampleEdit.ts`, `persist/sampleStorage.ts` (OPFS) |
| Something should change audibly without a recompile | a `paramRefs` ref, not `compileGraph` |

## Why things exist

- **Engine is a pure function** — unit-testable and reusable for offline bounce/headless playback.
- **Playback runs in the audio thread.** The `txSeq` native node (C++, compiled into the Elementary wasm) holds the per-slot sequences, runs the row clock, and the graph reads its outputs directly — the renderer has **zero Web Audio inputs**. The main thread uploads data (shared resource) and sends cmd/rowsPerSec props on a keyed ref. Note edits, transport, and BPM changes never recompile; the graph recompiles only on structural edits, detected by a `structuralKey` hash in `useEngine`. `txseq` events feed the UI row counter.
- **`paramRefs`** — `createRef`-backed nodes so sliders/mutes/CC updates hit Elementary live without recompile. `setValue` on an unmounted ref is queued and flushed after the next render.
- **Voice slots are pre-allocated** per instrument (max concurrent tracks in any pattern); tracks in non-overlapping pattern windows share slots. Mute refs are per slot: `tracker:{instId}:ts:{si}:mute`.
- **docStore** — Immer `mutate` recipes with undo; `mutateSilent` persists without triggering recompiles (slider drags). Only the `Doc` autosaves (OPFS `song.json`).
- **appStore** — persisted UI/performance state (localStorage): playMode, view, cursor, selected instrument/sample, **octave** (the single global keyboard range), and **mutedTrackNumbers/soloedTrackNumbers keyed by 1-based Track #**, not track id — so a mute applies to that position in every pattern.
- **`KeyboardPlayer`** (`audio/keyboardPlayer.ts`) — the one PC-keyboard note player: kit resolution + held-key tracking. App owns the global keydown/keyup listeners; views play through it.

## Rules that prevent recurring mistakes

- **The sequencer is C++ — `src/native/TxSeq.h`, registered in `src/native/Main.cpp`.** Changing it changes nothing until `scripts/build-elementary-wasm.sh` rebuilds the wasm and refreshes the renderer dists in **`vendor/elementary-js/`** (the source of truth; `package.json` depends on them via `file:`, so CI and fresh installs get the custom wasm without emsdk). The upstream fork lives in `vendor/elementary` (pinned at the web/offline v4.0.3 commit). After a rebuild: restart the dev server and clear `node_modules/.vite` if the browser still runs stale code.
- **txSeq channel contract moves in lockstep:** `engine/voiceSlotLayout.ts` (`MAX_SLOT_SIGNALS`, signal indexes, layout order), `player/txSeqData.ts` (packing), `src/native/TxSeq.h` (header layout, staccato indexes 10 / 2N+8), and `engine/compile.ts` (slot outlet = `slotGlobalIndex * MAX_SLOT_SIGNALS + signal` via `unpack`). Adding a lane means updating every one of them.
- **The txSeq ref is created once per host** (`useEngine` onReady, keyed `txseq`) — its identity and row clock survive recompiles. Live updates go through the ref setter (diffed props, no root activation); never `core.render` the txseq node alone (that would replace the roots).
- **Staccato is block-quantized and handled inside the node** — the graph never consumes the staccato channel.
- **Recompiles wipe param refs** (`paramRefs.clear()` resets them audible). After any structural recompile, mutes must be re-applied — `useEngine.applyMuteRefs` does this; keep calling it after `host.render`.
- **Never hand-roll track→slot mapping.** Use `mapPatternTracksToSlots` from `playbackData` — the per-pattern per-instrument counter increments even when a slot exceeds `slotCount`. Mute application and playback data must not drift.
- **Octave is one global** (`appStore.octave`). No local `useState` copies in views; `-`/`=` is handled once in App's global keydown — a second window listener double-fires.
- **Note keys are physical codes** (`CODE_TO_SEMITONE`: Z-row + Q-row). `KeyA` is not a piano key.
- **Keyboard routing per view:** App's keydown handles tracker (writes cells + short pip) and mixer (held notes via KeyboardPlayer); InstrumentsView/SampleLibraryView have their own keydown handlers. Don't add global handling for those views without removing the view's handler.
- **TrackerGrid `muted`/`soloed` props are keyed 1-based** (`muted[ti + 1]`), not by track id.
- **Shared slots are a known limitation, not a bug:** two patterns can map different track numbers to the same (instrument, slot); mute refs are static, so current-pattern-last wins.
- **The host is inert until a user gesture** (autoplay policy) — synthetic/synthesized key events won't start the AudioContext.
- **Elementary VFS keys are content hashes**; changing a conv/wave/sample module's `sampleIndex` is a structural change (forces recompile + VFS path change).

## Electron build (feature/electron-build)

- `npm run electron:build` builds with `vite.electron.config.ts` (base `./`); `electron:dist` packages via electron-builder.
- The renderer needs COOP/COEP headers — `electron/main.ts` injects them for `file://` responses inside `app.whenReady().then(…)` (touching `session.defaultSession` earlier hangs the main process).
- `index.html` guards the service-worker registration with `location.protocol !== 'file:'`.
- The Electron bundle should hash-match the web build of the same commit (`index-*.js`) — a mismatch means a stale vite dep cache (`node_modules/.vite`): clear it and rebuild.
- OPFS storage is per-origin — the Electron (`file://`) app does not share songs with the https site.
- Deploys: push a `deploy-vx.y.z` tag → web deploy (FTP) + Electron release (GitHub Releases) workflows.

## Testing — required on every code change

- Changes in `domain/`, `engine/`, `state/`, `persist/`, `player/playbackData` **ship a vitest** in the same folder. These are pure and have no excuse. Extend the existing `*.test.ts` next to the file rather than starting a parallel one.
- `ui/`, `audio/host`, `midi/`, and `src/native/` (C++) are **not unit-tested** — WebRenderer, AudioContext and OPFS aren't available under vitest. Cover them by `npm run typecheck` plus running the app. The txSeq node itself IS covered via the offline renderer in `src/engine/txSeq.test.ts` (SDK-wasm based, like the spike test).
- New logic that would be awkward to test belongs one layer down as a pure function, not inline in a view. That's what keeps coverage high.
- A schema change ships a `migrate` test that loads an old-version fixture.
- Before reporting done: `npm test` and `npm run typecheck`, both clean. Report failures, don't route around them.

## Style

- Function-first. Classes only for a mutable resource with a lifecycle (`AudioHost`, `KeyboardPlayer`, `ParamRefRegistry`); everything else is pure functions, stores and components. Don't wrap pure modules in classes.
- Respect layer direction: UI → state → engine → domain. The engine imports no React and no AudioContext.
- Don't grow `App.tsx` (~1000 lines) or `docStore.ts` (~1250) — new features get a new module or view, wired in from there.
- Comments stay short, English, why-not-what.
