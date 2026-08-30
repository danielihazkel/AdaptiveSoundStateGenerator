import { useEffect, useRef } from 'react';
import type { SessionController, SessionSnapshot } from '../session/sessionController';
import {
  clearMediaSession,
  setMediaHandlers,
  setMediaMetadata,
  setMediaPlaybackState,
  setMediaPosition,
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

  // Lifecycle: handlers once per controller; teardown only when the session
  // view goes away. Metadata changes must never run this cleanup — dropping
  // the keep-alive element mid-session is what kills iOS background audio.
  useEffect(() => {
    setMediaHandlers({
      onPause: () => {
        if (controller.phase === 'alarm') controller.dismissAlarm();
        else void controller.pause();
      },
      onResume: () => void controller.resume(),
      onStop: () => {
        if (controller.phase === 'alarm') controller.dismissAlarm();
        else controller.stop();
      },
    });
    const lock = wakeLock.current;
    return () => {
      clearMediaSession();
      stopSilentKeepAlive();
      lock?.release();
    };
  }, [controller]);

  useEffect(() => {
    setMediaMetadata({ title: meta.title, subtitle: meta.subtitle });
  }, [meta.title, meta.subtitle]);

  // Phase-driven state.
  const { phase, elapsedSec } = snapshot;
  useEffect(() => {
    const live =
      phase === 'running' || phase === 'paused' || phase === 'interrupted' || phase === 'alarm';
    const audible = phase === 'running' || phase === 'ending' || phase === 'alarm';
    if (live) playSilentKeepAlive();
    else stopSilentKeepAlive();
    if (audible) void wakeLock.current?.acquire();
    else wakeLock.current?.release();
    setMediaPlaybackState(audible ? 'playing' : live ? 'paused' : 'none');
  }, [phase]);

  useEffect(() => {
    if (phase === 'running' || phase === 'paused' || phase === 'ending') {
      setMediaPosition(meta.durationSec, elapsedSec);
    }
  }, [phase, elapsedSec, meta.durationSec]);
}
