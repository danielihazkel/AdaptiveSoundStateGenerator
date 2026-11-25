import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNative } from './native';

/**
 * What the Android app receives from outside: a shared `.resonance.json`
 * file (android/…/incoming/IncomingPlugin) and launcher-shortcut deep links
 * `resonance://start?start=focus&minutes=25` (the PWA manifest's shortcuts).
 * Both are no-ops in a browser, which gets the same things via the URL.
 */
export interface IncomingFile {
  name: string;
  text?: string;
  error?: string;
}

interface ResonanceIncomingPlugin {
  addListener(event: 'file', listener: (file: IncomingFile) => void): Promise<PluginListenerHandle>;
}

const ResonanceIncoming = registerPlugin<ResonanceIncomingPlugin>('ResonanceIncoming');

export const APP_URL_SCHEME = 'resonance:';

/** `resonance://start?start=focus` → `?start=focus`; anything else → null. */
export function quickStartSearchFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== APP_URL_SCHEME || parsed.host !== 'start') return null;
  return parsed.search || null;
}

function removeAll(handles: Promise<PluginListenerHandle>[]): () => void {
  return () => {
    for (const handle of handles) void handle.then((h) => h.remove()).catch(() => undefined);
  };
}

/** Files opened with / shared to the app. Returns an unsubscribe. */
export function onIncomingFile(cb: (file: IncomingFile) => void): () => void {
  if (!isNative()) return () => {};
  return removeAll([ResonanceIncoming.addListener('file', cb)]);
}

/**
 * Quick-start deep links: the one the app was launched with, then any that
 * arrive while it runs. `cb` gets the query string (`?start=…`).
 */
export function onQuickStartLink(cb: (search: string) => void): () => void {
  if (!isNative()) return () => {};
  let active = true;
  const deliver = (url: string | undefined) => {
    const search = url ? quickStartSearchFromUrl(url) : null;
    if (active && search) cb(search);
  };
  const handles: Promise<PluginListenerHandle>[] = [];
  const app = import('@capacitor/app').then(({ App }) => {
    void App.getLaunchUrl()
      .then((launch) => deliver(launch?.url))
      .catch(() => undefined);
    return App.addListener('appUrlOpen', ({ url }) => deliver(url));
  });
  handles.push(app);
  const remove = removeAll(handles);
  return () => {
    active = false;
    remove();
  };
}

/**
 * Android Back: walk the app's own history (useHashScreen keeps sessions
 * locked against it), and at the root send the app to the background rather
 * than closing it — closing would end a playing session or an export.
 */
export function installBackButton(): void {
  if (!isNative()) return;
  void import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    }),
  );
}
