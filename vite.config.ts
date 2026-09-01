/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  test: {
    // Node by default; React suites opt into jsdom per file.
    setupFiles: ["src/test/setup.ts"],
  },
  plugins: [
    react(),
    // Installable + offline: every build asset is precached, so the app
    // opens with no network (the audio was always synthesized locally).
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Resonance',
        short_name: 'Resonance',
        description: 'Adaptive sound states for focus, relaxation, sleep and energy.',
        theme_color: '#12141a',
        background_color: '#12141a',
        id: '/',
        scope: '/',
        display: 'standalone',
        start_url: '/',
        shortcuts: [
          {
            name: 'Focus 25 min',
            short_name: 'Focus',
            url: '/?start=focus&minutes=25',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Sleep',
            url: '/?start=sleep',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Play last session',
            short_name: 'Play last',
            url: '/?start=last',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        // Optional ambience recordings can be large; never precache them.
        globIgnores: ['**/ambience/**'],
        // Chunked exports never touch the network; nothing else to cache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
