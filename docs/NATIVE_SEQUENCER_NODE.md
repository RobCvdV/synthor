# Native sequencer node — refactor plan

Branch: `feature/native-sequencer-node` (off main at 7d30e15).

## Why

The current control-signal transport — scheduler AudioWorklets → Web Audio
inputs → `el.in` in Elementary — is unreliable. Empirical findings from the
electron-build investigation:

- Multi-input AudioWorkletNode delivery regresses unpredictably across
  Chromium versions (Electron 35/43, current Chrome/Edge), with undocumented,
  subtle triggers (connected-input counts, per-node input declarations, even
  the values carried on the control channels).
- The 32-channel-per-node cap limits the tracker to 3 × 32 = 96 control
  channels; the current song already uses 87. No growth headroom.

Both the reliability and the bandwidth questions answer "no" — so the
transport moves inside Elementary itself.

## Architecture

Keep the three-way separation (tracker sequencer / free-play + MIDI triggers /
Elementary instrument graph). Replace only the transport between sequencer and
graph with a **custom Elementary native node** (C++):

- The node holds the per-slot playback sequences (gate/freq/vol/staccato/
  per-slot effect values) in its own memory inside Elementary's WASM.
- It runs a block-accurate row clock (same math as the current scheduler
  worklet) and outputs per-slot control signals directly in the graph — no
  Web Audio channel limits, no browser input wiring at all.
- Real-time controls reach the node through Elementary's own property-update
  path (refs → node props): play/stop/panic, BPM/rowsPerSec, start row,
  per-channel effect controls (filter cutoff etc. — instrument-wide, the
  MIDI way).
- Bulk sequence data (the note rows) uploads at play/update time. Mechanism to
  verify in the spike: shared-resource access from custom nodes (the VFS
  mechanism `el.table` uses); fallback is a chunked param-write protocol.

Free-play keyboard and MIDI keep the existing ref-based live voices, which
work today. A later iteration can add a MIDI-style event input node (note on/
off + velocity via the same property path, channel controls instrument-wide)
to unify external triggering. Per-row effects the tracker delivers today
(vibrato depth per row etc.) stay as per-slot sequences inside the node —
more expressive than MIDI, and internal.

## What disappears

- `player/SchedulerNode.ts` + the inlined processor +
  `player/scheduler-processor.ts`
- the 32-channel batching in `useEngine` and the multi-Elementary-node split
  in `audio/host.ts` (back to a single Elementary node with **zero inputs**)
- `el.in` reads and the `channelBase` machinery in `engine/compile.ts`
- multi-core `ParamRefRegistry` (single renderer again)
- the slot-alignment-to-32-channel-boundary logic in
  `engine/voiceSlotLayout.ts`

## What stays

- `player/playbackData.ts` — sequence building (becomes the data source for
  the native-node upload)
- the instrument graph (`engine/instruments.ts`, `engine/modular.ts`), the
  mixer/master chain, VFS sample loading
- the ref-based live voices (`compileAllVoiceSlots`, `VoicePool`)
- transport store, playEpoch session logic, the output-settle warm-up

## Phase 0 — spike results (done)

All SDK questions answered **yes**; a `txspike` node runs in the app and
passes an offline test.

- **Toolchain**: `emsdk 3.1.52` (pinned, matches upstream's Docker image).
  Bleeding-edge emscripten (brew, 6.x) breaks the vendored `nlohmann/json`
  (`auto* const = iterator` — old libc++ implicit conversion). Build:
  `ELEM_BUILD_ASYNC=0/1 emcmake cmake -G Ninja -DCMAKE_BUILD_TYPE=Release
  -DONLY_BUILD_WASM=ON …` in `wasm/`; output is one closure-compiled JS file
  with the wasm embedded base64. Requires `--closure 1` → java. Ninja
  incremental rebuilds are ~seconds; full builds a few minutes. Submodules
  must be initialized first (`FFTConvolver`, `signalsmith-stretch`).
- **Custom nodes load in the web renderer** — the browser runtime is just
  `wasm/Main.cpp` (embind `ElementaryAudioProcessor`) + the extension nodes
  registered in `prepare()` (`convolve`, `fft`, `metro`, `time` — all built
  exactly like ours). We rebuild the `@elemaudio/web-renderer` and
  `@elemaudio/offline-renderer` packages from source with our wasm
  (`raw/elementary-wasm.js` / `elementary-wasm.cjs` replaced, then `tsup`).
  Both dists embed the module, so a plain node_modules swap works today; a
  proper vendored fork (submodule + build script) lands in phase 2.
- **Props → signal**: `setProperty(key, js::Value)` on the non-RT thread,
  atomics into `process`. Verified live in the browser via
  `core.createRef('txspike', …)` → `setTx({value})` — a 4× level jump on the
  analyser, no recompile. This is the paramRefs-equivalent path for
  play/stop/BPM/per-channel controls.
- **Bulk data ingestion**: shared resources — `renderer.updateVirtualFileSystem`
  (web) / `virtualFileSystem` option + `addSharedResource` (offline) upload
  `Float32Array`s by name; the node pulls them in
  `setProperty(key, val, SharedResourceMap&)` (the `el.table` pattern:
  `resources.get(name)` → lock-free queue → `process`). Data is **copied**
  into `AudioBufferResource` (no zero-copy). Update via content-hash keys
  (same as the current VFS) — resources cannot be overwritten.
- **Playhead feedback**: native-node **events** — override `processEvents`
  (non-RT thread, atomic flag from `process`, `MetronomeNode` pattern) and
  the renderer emits them on its EventEmitter (`core.on('txspike', …)`).
  Web renderer polls the worklet every `eventInterval` ms (default 16);
  offline processes per block. Row events are strictly coarser than
  block-accurate — fine for a UI playhead; keep the row math deterministic
  on the main thread anyway.
- **Offline tests**: `OfflineRenderer` runs the same wasm under vitest
  (node ≥18); events are testable synchronously inside `process()`.
  `src/engine/nativeNodeSpike.test.ts` covers all three paths.
- **Root semantics** (affects phase 2 design): root output sums only the
  root's **channel 0** (`RootRenderSequence::process`); a root has a 20ms
  fade-in on `active` (measured: 0.5×ramp at block 1). The sequencer node
  should output one channel, or sum in-graph (`el.add`) before the root.

## Phases
1. **Native sequencer core.** Port the scheduler processor to C++: row clock,
   play/stop/panic, tempo, per-slot signal fill, loop wrap.

   **Done.** `src/native/TxSeq.h` (registered in `src/native/Main.cpp`) plays
   packed per-slot sequences from one shared resource; commands arrive as a
   single `cmd` prop ({type: play|update|stop|panic, …}); `rowsPerSec` is a
   live tempo prop; `txseq` events report wrapped rows + loop. Offline
   verified in `src/engine/txSeq.test.ts` (gate rows, loop, stop/panic,
   block-quantized staccato, live tempo, mid-play update). The packing
   contract lives in `src/player/txSeqData.ts` (`buildTxSeqData`).
   Fork tooling: `vendor/elementary` submodule pinned at 60e7234
   (web/offline v4.0.3) + `scripts/build-elementary-wasm.sh` rebuilds the
   wasm and both renderer packages. The app does not use txSeq yet — that is
   phase 2.
2. **Graph rewire.** `compile.ts` consumes the native node's outputs;
   delete `el.in`, `channelBase`, the splits; single Elementary node, zero
   inputs; host simplification.

   **Done.** Slot s reads signal c from txSeq outlet `s*MAX_SLOT_SIGNALS+c`
   via `unpack(node, channels)[ch]` (`outputChannel` connection); the
   renderer initializes with `numberOfInputs: 0`. SchedulerNode + processor
   deleted; host exposes `core` + `pruneVfs`.
3. **Main-thread integration.** `useEngine` drives play/update/stop/tempo
   through the host API; keep the settle window and UI row reporting.

   **Done.** One keyed txSeq ref per host (row clock survives recompiles);
   note edits upload new packed data + `cmd update`; play/stop/rowsPerSec go
   through the ref setter (diffed props, no root activation); txseq events
   feed the UI row. Verified live in the browser: tracker audio, meter
   activity, 8 rows/sec at 120 BPM, loop wrap, stop. Phase 4 cleanup
   (stale docs/logs, delete txspike) remains.
4. **Cleanup + tests.** Remove the scheduler files; port engine tests to the
   native-node API; update CLAUDE.md.

   **Done.** txspike removed from the wasm and repo (spike test + dev harness
   deleted); the 32-channel alignment machinery (`slotBaseChannels`,
   `baseChannel`, `getSlotChannelOffset`, `totalChannels`, `channelOffset`)
   is gone from voiceSlotLayout/playbackData; tests ported (`slotGlobalIndex`,
   txSeq wiring assertions); CLAUDE.md rewritten for the native sequencer.
5. **Verification.** Browser matrix (Chrome/Edge/Safari/Firefox), Electron,
   offline tests, the demo song and the user's 87-channel song.

   **Verified live**: Chrome + Safari play the full song cleanly (meter
   follows the notes, row clock exact at 120 BPM, loop wrap, stop). Edge
   runs the graph (meters live) but needs a local output-device/permission
   check — its output stage, not the app. Firefox is a known limitation:
   its AudioWorklet underruns at 128-sample blocks on the SAB-heavy
   Elementary runtime (slow-motion, bitcrushed audio) — out of scope.
   Electron + the deploy flows remain.

## Risks

- **Forked renderer packages** — we now depend on locally built
  `@elemaudio/web-renderer`/`offline-renderer` (custom wasm inside).
  Upgrading either package means rebuilding the fork; keep the elementary
  repo as a vendored submodule + one build script (phase 2).
- **emsdk in CI** — the wasm build needs emsdk 3.1.52 + java (closure) +
  git submodules; pin it in the deploy workflow.
- **Native-node API drift** — `GraphNode`/`SharedResource`/event APIs are
  stable upstream today, but Elementary can change them between releases;
  the pinned fork insulates us.
