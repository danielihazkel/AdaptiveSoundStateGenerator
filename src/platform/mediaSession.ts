/**
 * Media Session API: lock-screen / notification / hardware-key transport for
 * a running session. Silent no-op where unsupported. Pair with the silent
 * keep-alive element (silentAudio.ts) — browsers only surface these controls
 * while an HTMLMediaElement is playing.
 */
export interface MediaSessionHandlers {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const supported = (): boolean =>
  typeof navigator !== 'undefined' && 'mediaSession' in navigator;

/** Title/subtitle only — safe to call again mid-session. */
export function setMediaMetadata(meta: { title: string; subtitle?: string }): void {
  if (!supported()) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.subtitle ?? 'Resonance',
      album: 'Resonance',
    });
  } catch {
    /* ignore */
  }
}

export function setMediaHandlers(handlers: MediaSessionHandlers): void {
  if (!supported()) return;
  const session = navigator.mediaSession;
  try {
    session.setActionHandler('pause', handlers.onPause);
    session.setActionHandler('play', handlers.onResume);
    session.setActionHandler('stop', handlers.onStop);
  } catch {
    // Older implementations throw on unknown actions — ignore.
  }
}

export function setMediaSession(
  meta: { title: string; subtitle?: string },
  handlers: MediaSessionHandlers,
): void {
  setMediaMetadata(meta);
  setMediaHandlers(handlers);
}

export function setMediaPlaybackState(state: 'playing' | 'paused' | 'none'): void {
  if (!supported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}

export function setMediaPosition(durationSec: number, positionSec: number): void {
  if (!supported() || typeof navigator.mediaSession.setPositionState !== 'function') return;
  try {
    navigator.mediaSession.setPositionState({
      duration: Math.max(0, durationSec),
      position: Math.min(Math.max(0, positionSec), Math.max(0, durationSec)),
      playbackRate: 1,
    });
  } catch {
    /* invalid state (e.g. duration 0) — ignore */
  }
}

export function clearMediaSession(): void {
  if (!supported()) return;
  const session = navigator.mediaSession;
  try {
    session.metadata = null;
    session.playbackState = 'none';
    for (const action of ['pause', 'play', 'stop'] as const) {
      session.setActionHandler(action, null);
    }
  } catch {
    /* ignore */
  }
}
