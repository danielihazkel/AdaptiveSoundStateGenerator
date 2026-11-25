/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// `--mode native` builds the bundle the Android app ships (capacitor.config.ts):
// no service worker or web manifest — the APK is the offline install, and
// updates arrive as a new APK.
export default defineConfig(({ mode }) => ({
  test: {
    // Node by default; React suites opt into jsdom per file.
    setupFiles: ["src/test/setup.ts"],
    // Browser specs in e2e/ belong to Playwright.
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias:
      mode === 'native'
        ? { 'virtual:pwa-register': fileURLToPath(new URL('./src/platform/pwaRegisterStub.ts', import.meta.url)) }
        : ({} as Record<string, string>),
  },
  plugins: [
    react(),
    mode !== 'native' &&
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
        // Optional ambience recordings can be large; never precache them…
        globIgnores: ['**/ambience/**'],
        // …but keep the ones actually played, so they still play offline
        // (ambienceAssets.ts falls back to this cache when its probe fails).
        runtimeCaching: [
          {
            urlPattern: /\/ambience\/[^/]+\.(?:mp3|ogg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ambience-recordings',
              expiration: { maxEntries: 20 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
        // Chunked exports never touch the network; nothing else to cache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
}));
