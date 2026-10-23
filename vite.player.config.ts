/**
 * Library build of the headless SongPlayer (`npm run build:player`).
 *
 * One self-contained ES module: Elementary core, the vendored renderer with
 * the txSeq wasm, and fflate are bundled in, so a host app (e.g. a game)
 * needs no emsdk build and no synthor dependencies of its own.
 */

import { defineConfig } from 'vite'

export default defineConfig({
  // The app's icons and manifest don't belong in a library.
  publicDir: false,
  // Elementary's deps (invariant) read process.env, which browsers lack; lib builds don't replace it.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: 'src/headless/index.ts',
      formats: ['es'],
      fileName: 'synthor-player',
    },
    outDir: 'packages/synthor-player/dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
