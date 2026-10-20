import { describe, expect, it, vi } from 'vitest';
import type { MotionSample } from '../biometrics/motion';
import type { BiometricSample } from '../biometrics/types';
import type { SessionController, SessionSnapshot } from '../session/sessionController';
import { stirring, watchSmartWake } from './smartWakeWatcher';

const T0 = 1_000_000;

/** 1 Hz motion epochs over `minutes`; `restless(sec)` adds 4 s bursts every 30 s. */
function motion(minutes: number, restless: (sec: number) => boolean = () => false): MotionSample[] {
  return Array.from({ length: minutes * 60 }, (_, i) => ({
    timestamp: T0 + i * 1000,
    activity: restless(i) && i % 30 < 4 ? 0.6 : 0.02 + ((i * 7) % 5) * 0.002,
  }));
}

/** 1 Hz heart rate following bpm(minute). */
function hr(minutes: number, bpm: (minute: number) => number): BiometricSample[] {
  return Array.from({ length: minutes * 60 }, (_, i) => ({
    timestamp: T0 + i * 1000,
    heartRateBpm: Math.round(bpm(i / 60)),
  }));
}

const now = (minutes: number) => T0 + minutes * 60_000;

describe('stirring', () => {
  it('tossing on the mattress, or a heart rate climbing over the last minutes', () => {
    expect(stirring([], motion(30, (s) => s > 27 * 60), now(30))).toBe(true);
    expect(stirring([], motion(30), now(30))).toBe(false);
    // Lower all night, climbing at the end — judged against the recent 20 min, not bedtime.
    expect(stirring(hr(60, (m) => (m < 57 ? 52 : 60)), [], now(60))).toBe(true);
    expect(stirring(hr(60, () => 52), [], now(60))).toBe(false);
  });
});

/** A controller double: drive snapshots by hand, count wakeNow calls. */
function fakeController() {
  const listeners = new Set<() => void>();
  let snapshot: SessionSnapshot = { phase: 'running', elapsedSec: 0, remainingSec: 0 };
  const controller = {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    wakeNow: vi.fn(() => true),
  };
  const tick = (elapsedSec: number, remainingSec: number) => {
    snapshot = { phase: 'running', elapsedSec, remainingSec };
    for (const l of listeners) l();
  };
  return { controller: controller as unknown as SessionController, wakeNow: controller.wakeNow, tick, listeners };
}

describe('watchSmartWake', () => {
  it('only acts inside the window, on the first stir, once', () => {
    const { controller, wakeNow, tick, listeners } = fakeController();
    let stirred = false;
    vi.spyOn(Date, 'now').mockReturnValue(now(30));
    const restless = motion(30, (s) => s > 27 * 60);
    const quiet = motion(30);
    watchSmartWake(controller, { windowSec: 20 * 60, riseSec: 10 * 60 }, () => [], () =>
      stirred ? restless : quiet,
    );
    // 40 min to the alarm: 30 min until the rise — outside a 20 min window.
    stirred = true;
    tick(1000, 40 * 60);
    expect(wakeNow).not.toHaveBeenCalled();
    // Inside the window but lying still.
    stirred = false;
    tick(1600, 25 * 60);
    expect(wakeNow).not.toHaveBeenCalled();
    // Stirring inside the window → wake now, then unsubscribe.
    stirred = true;
    tick(1660, 24 * 60);
    expect(wakeNow).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    vi.restoreAllMocks();
  });

  it('gives up once the planned rise has begun', () => {
    const { controller, wakeNow, tick, listeners } = fakeController();
    watchSmartWake(controller, { windowSec: 20 * 60, riseSec: 10 * 60 }, () => [], () => []);
    tick(5000, 9 * 60);
    expect(listeners.size).toBe(0);
    expect(wakeNow).not.toHaveBeenCalled();
  });
});
