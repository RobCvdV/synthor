#!/usr/bin/env bash
# Rebuild the Elementary wasm with the synthor native nodes (src/native/*) and
# reinstall the locally built renderer packages into node_modules.
#
# Requirements: emsdk 3.1.52 activated (https://github.com/emscripten-core/emsdk),
# java (for closure), and `git submodule update --init` for vendor/elementary
# (plus its FFTConvolver + signalsmith-stretch submodules).
# See docs/NATIVE_SEQUENCER_NODE.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELEM="$ROOT/vendor/elementary"

# ── toolchain ────────────────────────────────────────────────────────────
if ! command -v emcc >/dev/null 2>&1 || ! emcc --version 2>/dev/null | head -1 | grep -q "3.1.52"; then
  [[ -f "$HOME/.emsdk/emsdk_env.sh" ]] || { echo "emsdk 3.1.52 required"; exit 1; }
  # shellcheck disable=SC1091
  source "$HOME/.emsdk/emsdk_env.sh"
fi
emcc --version | head -1

# ── overlay synthor nodes onto the upstream wasm dir ─────────────────────
cp "$ROOT"/src/native/Main.cpp "$ROOT"/src/native/*.h "$ELEM/wasm/"

build_wasm() {
  local variant="$1"  # web (sync) | node (async)
  local build_dir="$ELEM/build/$variant"

  mkdir -p "$build_dir"
  (
    cd "$build_dir"
    if [[ "$variant" == "node" ]]; then ELEM_BUILD_ASYNC=1; else ELEM_BUILD_ASYNC=0; fi
    export ELEM_BUILD_ASYNC
    emcmake cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -DONLY_BUILD_WASM=ON \
      -DCMAKE_CXX_FLAGS="-O3" "$ELEM" >/dev/null
    emmake ninja
  )
  echo "built $variant wasm: $build_dir/wasm/elementary-wasm.js"
}

# ── wasm ─────────────────────────────────────────────────────────────────
build_wasm web
build_wasm node

# ── renderer packages ────────────────────────────────────────────────────
cp "$ELEM/build/web/wasm/elementary-wasm.js" "$ELEM/js/packages/web-renderer/raw/elementary-wasm.js"
cp "$ELEM/build/node/wasm/elementary-wasm.js" "$ELEM/js/packages/offline-renderer/elementary-wasm.cjs"

for pkg in web-renderer offline-renderer; do
  (
    cd "$ELEM/js/packages/$pkg"
    [[ -d node_modules ]] || npm install --no-audit --no-fund
    npm run build >/dev/null
  )
  # vendor/elementary-js is the source of truth — package.json depends on it
  # via file:, so node_modules follows (symlink, or npm install refreshes copies).
  cp "$ELEM/js/packages/$pkg/dist/index.js" \
     "$ELEM/js/packages/$pkg/dist/index.cjs" \
     "$ELEM/js/packages/$pkg/dist/index.d.ts" \
     "$ROOT/vendor/elementary-js/$pkg/dist/"
  # Refresh any copied (non-symlinked) installs too.
  if [[ ! -L "$ROOT/node_modules/@elemaudio/$pkg" ]]; then
    cp "$ELEM/js/packages/$pkg/dist/index.js" \
       "$ELEM/js/packages/$pkg/dist/index.cjs" \
       "$ELEM/js/packages/$pkg/dist/index.d.ts" \
       "$ROOT/node_modules/@elemaudio/$pkg/dist/"
  fi
done

echo "done — restart the dev server (vite caches the old dep bundle)"
