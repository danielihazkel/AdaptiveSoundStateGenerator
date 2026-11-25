import { Capacitor } from '@capacitor/core';

/**
 * True inside the Android app (Capacitor's WebView), false in any browser,
 * including the installed PWA. Every native-only branch goes through this
 * one check, so the web build behaves exactly as it did before the app.
 */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
