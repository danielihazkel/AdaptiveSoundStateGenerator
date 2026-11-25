/**
 * Stands in for `virtual:pwa-register` in the native build (vite.config.ts
 * aliases it there): the Android app has no service worker, so there is
 * nothing to register and no update toast — new builds arrive as a new APK.
 */
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
