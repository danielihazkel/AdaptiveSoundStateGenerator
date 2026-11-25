import { useEffect, useRef } from 'react';
import type { SessionController, SessionSnapshot } from '../session/sessionController';
import {
  type MediaMeta,
  clearMediaSession,
  setMediaHandlers,
  setMediaMetadata,
  setMediaPlaybackState,
  setMediaPosition,
} from './mediaSession';
import { isNative } from './native';
import { NativeSessionBackend, ResonanceSession, type PlatformHandlers } from './nativeSession';
import { playSilentKeepAlive, stopSilentKeepAlive } from './silentAudio';
import { WakeLockHolder } from './wakeLock';

/**
 * Where a live session's transport and keep-alive go: the browser's Media
 * Session API plus the silent <audio> keep-alive, or — in the Android app —
 * the native background session service (nativeSession.ts).
 */
export interface SessionPlatformBackend {
  setHandlers(handlers: PlatformHandlers): void;
  setMetadata(meta: MediaMeta): void;
  /** 'playing' / 'paused' while the session is live, 'none' after. */
  setPlaybackState(state: 'playing' | 'paused' | 'none', live: boolean): void;
  setPosition(durationSec: number, positionSec: number): void;
  clear(): void;
}

const webBackend: SessionPlatformBackend = {
  setHandlers: setMediaHandlers,
  setMetadata: setMediaMetadata,
  setPlaybackState(state, live) {
    // Browsers only surface media controls (and iOS only keeps audio alive
    // in the background) for a playing HTMLMediaElement.
    if (live) playSilentKeepAlive();
    else stopSilentKeepAlive();
    setMediaPlaybackState(state);
  },
  setPosition: setMediaPosition,
  clear() {
    clearMediaSession();
    stopSilentKeepAlive();
  },
};

function createBackend(): SessionPlatformBackend {
  if (!isNative()) return webBackend;
  const native = new NativeSessionBackend(ResonanceSession);
  return {
    setHandlers: (h) => native.setHandlers(h),
    setMetadata: (m) => native.setMetadata(m),
    setPlaybackState: (state) => native.setPlaybackState(state),
    setPosition: (d, p) => native.setPosition(d, p),
    clear: () => native.clear(),
  };
}

/**
 * Binds the platform integrations to a live session: screen wake lock while
 * playing, lock-screen transport with the keep-alive that makes it appear
 * (and keeps the sound going with the screen off), and position updates.
 * Everything is released when the session ends or the session screen
 * unmounts.
 */
export function useSessionPlatform(
  controller: SessionController,
  snapshot: SessionSnapshot,
  meta: MediaMeta & { durationSec: number },
  backendFactory: () => SessionPlatformBackend = createBackend,
): void {
  const wakeLock = useRef<WakeLockHolder | null>(null);
  wakeLock.current ??= new WakeLockHolder();
  const backendRef = useRef<SessionPlatformBackend | null>(null);
  backendRef.current ??= backendFactory();
  const backend = backendRef.current;

  // Lifecycle: handlers once per controller; teardown only when the session
  // view goes away. Metadata changes must never run this cleanup — dropping
  // the keep-alive mid-session is what kills background audio.
  useEffect(() => {
    backend.setHandlers({
      onPause: () => {
        if (controller.phase === 'alarm') controller.dismissAlarm();
        else void controller.pause();
      },
      onResume: () => void controller.resume(),
      onStop: () => {
        if (controller.phase === 'alarm') controller.dismissAlarm();
        else controller.stop();
      },
      onInterrupt: () => void controller.interrupt(),
      onInterruptEnd: () => {
        if (controller.phase === 'interrupted') void controller.resume();
      },
    });
    const lock = wakeLock.current;
    return () => {
      backend.clear();
      lock?.release();
    };
  }, [controller, backend]);

  useEffect(() => {
    backend.setMetadata({ title: meta.title, subtitle: meta.subtitle, artwork: meta.artwork });
  }, [backend, meta.title, meta.subtitle, meta.artwork]);

  // Phase-driven state.
  const { phase, elapsedSec } = snapshot;
  useEffect(() => {
    const live =
      phase === 'running' || phase === 'paused' || phase === 'interrupted' || phase === 'alarm';
    const audible = phase === 'running' || phase === 'ending' || phase === 'alarm';
    if (audible) void wakeLock.current?.acquire();
    else wakeLock.current?.release();
    backend.setPlaybackState(audible ? 'playing' : live ? 'paused' : 'none', live);
  }, [backend, phase]);

  useEffect(() => {
    if (phase === 'running' || phase === 'paused' || phase === 'ending') {
      backend.setPosition(meta.durationSec, elapsedSec);
    }
  }, [backend, phase, elapsedSec, meta.durationSec]);
}
