import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app (see README → "Android app"): the same web build, made with
 * `npm run build:native` (no service worker) and bundled into the APK, so it
 * runs offline with no server. `appId` is permanent once published.
 */
const config: CapacitorConfig = {
  appId: 'app.resonance',
  appName: 'Resonance',
  webDir: 'dist',
  backgroundColor: '#12141a',
  server: {
    // Serve from https://localhost so the WebView is a secure context
    // (AudioWorklet, getUserMedia and Web Crypto need one).
    androidScheme: 'https',
  },
};

export default config;
