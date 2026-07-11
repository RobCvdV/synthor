/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Self-signed HTTPS so AudioWorklet + the service worker get a secure
    // context when the dev server is opened from other devices on the LAN.
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      // Register/serve the service worker under `vite dev` too, not just builds.
      devOptions: {
        enabled: true,
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
  server: {
    // Listen on all interfaces so the dev server is reachable over the LAN.
    host: true,
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
