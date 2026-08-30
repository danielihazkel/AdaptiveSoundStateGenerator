import { useEffect, useRef } from 'react';
import type { SessionController, SessionSnapshot } from '../session/sessionController';
import {
  clearMediaSession,
  setMediaPlaybackState,
  setMediaPosition,
  setMediaSession,
} from './mediaSession';
import { playSilentKeepAlive, stopSilentKeepAlive } from './silentAudio';
import { WakeLockHolder } from './wakeLock';

/**
 * Binds the platform integrations to a live session: screen wake lock while
 * playing, lock-screen transport (Media Session) with the silent keep-alive
 * that makes it appear, and position updates. Everything is released when
 * the session ends or the session screen unmounts.
 */
export function useSessionPlatform(
  controller: SessionController,
  snapshot: SessionSnapshot,
  meta: { title: string; subtitle?: string; durationSec: number },
): void {
  const wakeLock = useRef<WakeLockHolder | null>(null);
  wakeLock.current ??= new WakeLockHolder();

  // Metadata + handlers: once per session (title changes only with a new session).
  useEffect(() => {
    setMediaSession(
      { title: meta.title, subtitle: meta.subtitle },
      {
        onPause: () => void controller.pause(),
        onResume: () => void controller.resume(),
        onStop: () => controller.stop(),
      },
    );
    return () => {
      clearMediaSession();
      stopSilentKeepAlive();
      wakeLock.current?.release();
    };
  }, [controller, meta.title, meta.subtitle]);

  // Phase-driven state.
  const { phase, elapsedSec } = snapshot;
  useEffect(() => {
    const live = phase === 'running' || phase === 'paused' || phase === 'interrupted';
    if (live) playSilentKeepAlive();
    else stopSilentKeepAlive();
    if (phase === 'running' || phase === 'ending') void wakeLock.current?.acquire();
    else wakeLock.current?.release();
    setMediaPlaybackState(
      phase === 'running' || phase === 'ending' ? 'playing' : live ? 'paused' : 'none',
    );
  }, [phase]);

  useEffect(() => {
    if (phase === 'running' || phase === 'paused' || phase === 'ending') {
      setMediaPosition(meta.durationSec, elapsedSec);
    }
  }, [phase, elapsedSec, meta.durationSec]);
}
