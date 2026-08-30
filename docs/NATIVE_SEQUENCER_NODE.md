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

## Phases

0. **Spike — verify the SDK.** Custom-node toolchain (emscripten/CMake,
   `@elemaudio/node-renderer`), load a built node module into the web
   renderer + vite, confirm: property updates on custom nodes, bulk data
   ingestion (shared resources or param protocol), offline-renderer support
   for tests, and a mechanism for row feedback to the UI playhead (native
   node events or a row output channel). Deliverable: a trivial native node
   running in the app + one offline test.
1. **Native sequencer core.** Port the scheduler processor to C++: row clock,
   play/stop/panic, tempo, per-slot signal fill, loop wrap.
2. **Graph rewire.** `compile.ts` consumes the native node's outputs;
   delete `el.in`, `channelBase`, the splits; single Elementary node, zero
   inputs; host simplification.
3. **Main-thread integration.** `useEngine` drives play/update/stop/tempo
   through the host API; keep the settle window and UI row reporting.
4. **Cleanup + tests.** Remove the scheduler files; port engine tests to the
   native-node API; update CLAUDE.md.
5. **Verification.** Browser matrix (Chrome/Edge/Safari/Firefox), Electron,
   offline tests, the demo song and the user's 87-channel song.

## Risks

- SDK capability gaps (spike first — it decides the data-ingestion and
  playhead-feedback designs).
- C++ build loop slows dev iteration; mitigate with a local build script.
- Custom node in the offline-renderer (needed for engine tests).
