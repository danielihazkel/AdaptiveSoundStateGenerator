import { computeHrTrend } from '../biometrics/hrTrend';
import { computeMotionTrend, type MotionSample } from '../biometrics/motion';
import type { BiometricSample } from '../biometrics/types';
import type { SessionController } from '../session/sessionController';

/** Evaluate at most once per this many seconds of listening time. */
export const SMART_WAKE_CHECK_EVERY_SEC = 30;
/** "Stirring" is judged over this recent stretch… */
export const STIR_WINDOW_MS = 3 * 60_000;
/** …against the heart rate of this long before it (not the evening's awake baseline). */
export const STIR_HR_BASELINE_MS = 20 * 60_000;

export interface SmartWakeWatch {
  stop(): void;
}

/**
 * Light sleep, as far as a phone can tell: tossing and turning on the
 * mattress, or a heart rate climbing over the last few minutes against the
 * twenty before them. Pure.
 */
export function stirring(
  hr: readonly BiometricSample[],
  motion: readonly MotionSample[],
  now: number,
): boolean {
  if (computeMotionTrend(motion, { now, recentWindowMs: STIR_WINDOW_MS })?.trend === 'restless') {
    return true;
  }
  const recentHr = hr.filter((s) => now - s.timestamp <= STIR_HR_BASELINE_MS + STIR_WINDOW_MS);
  const trend = computeHrTrend([...recentHr], {
    now,
    baselineWindowMs: STIR_HR_BASELINE_MS,
    recentWindowMs: STIR_WINDOW_MS,
  });
  return trend?.trend === 'rising';
}

/**
 * Smart wake (Phase 16): while a wake-up session is inside its window — the
 * last `windowSec` before the alarm, minus the rise itself — check every
 * 30 s of listening whether the user is stirring, and on the first yes ask
 * the controller to start the rise now (wakeNow), so they surface from a
 * light moment instead of being dragged out of deep sleep at a fixed time.
 * One-shot, like the sleep-onset watch; without a live sensor it never
 * fires and the alarm rings at the planned time.
 */
export function watchSmartWake(
  controller: SessionController,
  opts: { windowSec: number; riseSec: number },
  getHr: () => BiometricSample[],
  getMotion: () => MotionSample[],
): SmartWakeWatch {
  let lastBucket = -1;
  let stopped = false;
  const unsubscribe = controller.subscribe(() => {
    if (stopped) return;
    const { phase, elapsedSec, remainingSec } = controller.getSnapshot();
    if (phase !== 'running') return;
    // Live, so snooze / +15 min move the window with the end.
    const untilRise = remainingSec - opts.riseSec;
    if (untilRise <= 0) {
      stop(); // the planned rise has begun — nothing left to bring forward
      return;
    }
    if (untilRise > opts.windowSec) return;
    const bucket = Math.floor(elapsedSec / SMART_WAKE_CHECK_EVERY_SEC);
    if (bucket === lastBucket) return;
    lastBucket = bucket;
    if (!stirring(getHr(), getMotion(), Date.now())) return;
    stop();
    // The controller remembers when (SessionResult.smartWakeAtSec).
    controller.wakeNow();
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
  return { stop };
}
