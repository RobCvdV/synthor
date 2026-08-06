/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only enable PWA in production builds — the service worker
      // can't generate correctly in dev mode (no workbox manifest).
      devOptions: {
        enabled: false,
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Synthor',
        short_name: 'Synthor',
        description: 'Tracker synth',
        theme_color: '#0e1014',
        background_color: '#0e1014',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: (() => {
    const certDir = './certs';
    const keyPath = `${certDir}/privkey.pem`;
    const certPath = `${certDir}/fullchain.pem`;
    let https: { key: Buffer; cert: Buffer } | undefined;
    try {
      https = {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      };
    } catch {
      // certs not available (CI, fresh clone) — skip HTTPS
      https = undefined;
    }
    return {
      // Listen on all interfaces so the dev server is reachable over the LAN.
      host: true,
      // Fixed port so OPFS localStorage is stable across dev restarts.
      port: 5173,
      strictPort: true,
      // Cross-origin isolation headers required for SharedArrayBuffer.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      ...(https ? { https } : {}),
    };
  })(),
  test: {
    environment: 'node',
    globals: true,
  },
})
