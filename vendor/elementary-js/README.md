# vendored Elementary renderer packages (synthor fork)

Local forks of `@elemaudio/web-renderer` and `@elemaudio/offline-renderer`
(4.0.3) with the **txSeq native sequencer node compiled into the embedded
wasm**. `package.json` depends on these via `file:` so a fresh
`npm install` — including CI — gets the custom wasm.

- Built from `vendor/elementary` (pinned at the web/offline v4.0.3 commit)
  by `scripts/build-elementary-wasm.sh`; the script regenerates the `dist/`
  files here.
- The C++ sources live in `src/native/` — changing them changes nothing
  until the build script runs. Committed dists exist so normal installs
  and CI never need emsdk.
- Version `4.0.3-synthor.1` marks the fork; upstream API compatibility is
  preserved. Upgrading Elementary = bump `vendor/elementary`, rebuild,
  re-commit these dists.

See `docs/NATIVE_SEQUENCER_NODE.md`.
