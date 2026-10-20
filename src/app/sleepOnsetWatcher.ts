import { detectSleepOnsetFromMotion, isStill, motionLive, type MotionSample } from '../biometrics/motion';
import type { BiometricSample } from '../biometrics/types';
import { detectSleepOnset, SLEEP_ONSET_DEFAULTS } from '../biometrics/sleepOnset';
import type { SessionController } from '../session/sessionController';

/** Evaluate at most once per this many seconds of listening time. */
export const SLEEP_ONSET_CHECK_EVERY_SEC = 30;

export interface SleepOnsetWatch {
  stop(): void;
}

/**
 * Watches an opted-in sleep session for sleep onset (Phase 9): every 30 s of
 * listening time it runs the pure detector over the in-memory heart-rate
 * samples and, on the first positive verdict, asks the controller to wind
 * the session down (completed, normal sleep fade, no chime). One-shot: after
 * firing — or after a refused windDown (e.g. the planned end is already
 * near) — it unsubscribes itself. Deliberately outside the adaptation loop,
 * whose 10-minute cadence and served-arm gate would skip preset/replay
 * sleep sessions.
 *
 * Phase 16: with the phone's motion live too, a live heart rate still
 * decides but movement can veto it (the detector's stillness seam); with
 * no live heart rate, sustained stillness alone decides (actigraphy).
 */
export function watchSleepOnset(
  controller: SessionController,
  getSamples: () => BiometricSample[],
  onOnset: (elapsedSec: number) => void,
  getMotion: () => MotionSample[] = () => [],
): SleepOnsetWatch {
  let lastBucket = -1;
  let stopped = false;
  const unsubscribe = controller.subscribe(() => {
    if (stopped) return;
    const { phase, elapsedSec } = controller.getSnapshot();
    if (phase !== 'running') return;
    const bucket = Math.floor(elapsedSec / SLEEP_ONSET_CHECK_EVERY_SEC);
    if (bucket === lastBucket) return;
    lastBucket = bucket;
    if (!asleep(getSamples(), getMotion(), Date.now())) return;
    stop();
    if (controller.windDown()) onOnset(elapsedSec);
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
  return { stop };
}

/** The combined verdict: heart rate (with a movement veto) first, else movement alone. */
export function asleep(hr: readonly BiometricSample[], motion: readonly MotionSample[], now: number): boolean {
  const lastHr = hr[hr.length - 1];
  const hrLive = lastHr !== undefined && now - lastHr.timestamp <= SLEEP_ONSET_DEFAULTS.staleMs;
  const motionOn = motionLive(motion, now);
  if (hrLive) {
    const stillness = motionOn
      ? (isStill(motion, { now, sustainMs: SLEEP_ONSET_DEFAULTS.sustainMs }) ?? undefined)
      : undefined;
    return detectSleepOnset(hr, { now, stillness }).onset;
  }
  return motionOn && detectSleepOnsetFromMotion(motion, { now });
}
