/**
 * Vite config for Electron development.
 *
 * Same renderer as the web build but without PWA/SSL — Electron provides a
 * secure context natively and service workers are a web-only concern.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5193,
    strictPort: true,
    // Cross-origin isolation required for SharedArrayBuffer (Elementary).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: 'dist',
  },
})
