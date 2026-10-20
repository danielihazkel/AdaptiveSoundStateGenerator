import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../audio/engine';
import { STATES } from '../audio/states';
import { evaluateProgram } from '../programs/evaluator';
import { BREATH_PATTERNS } from '../audio/breathing';
import { defaultProgram } from '../programs/types';
import {
  ALARM_MAX_SEC,
  ARC_PLATEAU_T,
  OPEN_ENDED_STOP_FADE_MAX_SEC,
  SessionController,
  type SessionConfig,
  type SessionResult,
} from './sessionController';
import { evaluateArc, resolveArc } from './evolution';
import { ADAPT_RAMP_TIME_CONSTANT } from '../audio/ramp';
import { PROGRAM_TYPE_FADE_SEC } from '../programs/evaluator';

function stubEngine() {
  const contextListeners = new Set<(state: AudioContextState) => void>();
  return {
    subscribeContextState: vi.fn((listener: (state: AudioContextState) => void) => {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    }),
    /** Simulates the AudioContext changing state under us. */
    emitContextState: (state: AudioContextState) => {
      for (const l of contextListeners) l(state);
    },
    listenerCount: () => contextListeners.size,
    applyProfile: vi.fn(),
    setArcModulation: vi.fn(),
    setProgramModulation: vi.fn(),
    setBreathPattern: vi.fn(),
    playCue: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(),
  };
}

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    state: 'focus',
    intensity: 0.5,
    durationSec: 60,
    profile: STATES.focus.buildProfile(0.5),
    chimeEnabled: true,
    ...overrides,
  };
}

describe('SessionController', () => {
  let engine: ReturnType<typeof stubEngine>;
  let controller: SessionController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    engine = stubEngine();
    controller = new SessionController(engine as unknown as AudioEngine);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('runs to completion: ending starts at T - fadeSeconds, then finished', async () => {
    const results: boolean[] = [];
    controller.onComplete = (r) => results.push(r.completed);
    await controller.start(config());

    expect(controller.phase).toBe('running');
    await vi.advanceTimersByTimeAsync(57_000);
    expect(controller.phase).toBe('running');

    // focus end fade is 1.5s → 'ending' within one tick of T-1.5s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.phase).toBe('ending');
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.phase).toBe('finished');
    expect(results).toEqual([true]);
  });

  it('passes chime=false when the user opted out', async () => {
    await controller.start(config({ chimeEnabled: false }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it('never chimes for sleep even with chimeEnabled', async () => {
    await controller.start(config({ state: 'sleep', durationSec: 120, chimeEnabled: true }));
    // sleep fade is 60s → ending begins at T-60s
    await vi.advanceTimersByTimeAsync(61_000);
    expect(controller.phase).toBe('ending');
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it('a program endChime overrides the base state: a sleep nap can wake with a chime', async () => {
    const program = { ...defaultProgram('sleep', 0.5), endChime: true };
    await controller.start(
      config({ state: 'sleep', durationSec: 120, chimeEnabled: false, program }),
    );
    await vi.advanceTimersByTimeAsync(61_000);
    expect(controller.phase).toBe('ending');
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('a wake-up sleep session fades over 3 s without a chime (the alarm rings after)', async () => {
    await controller.start(
      config({ state: 'sleep', durationSec: 120, chimeEnabled: false, wakeUp: { riseSec: 30 } }),
    );
    await vi.advanceTimersByTimeAsync(61_000);
    expect(controller.phase).toBe('running'); // sleep's 60 s fade is replaced
    await vi.advanceTimersByTimeAsync(56_500);
    expect(controller.phase).toBe('ending');
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it('hands the breathing pattern to the engine on start, and clears it otherwise', async () => {
    await controller.start(config({ state: 'calm', breathing: BREATH_PATTERNS.box }));
    expect(engine.setBreathPattern).toHaveBeenLastCalledWith(BREATH_PATTERNS.box);
    controller.stop();
    await controller.start(config({ state: 'calm' }));
    expect(engine.setBreathPattern).toHaveBeenLastCalledWith(null);
  });

  it('a program session never breathes', async () => {
    await controller.start(
      config({ program: defaultProgram('calm', 0.5), breathing: BREATH_PATTERNS.box }),
    );
    expect(engine.setBreathPattern).toHaveBeenLastCalledWith(null);
  });

  it('pause freezes the clock, resume continues it', async () => {
    await controller.start(config());
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.pause();
    expect(controller.phase).toBe('paused');

    await vi.advanceTimersByTimeAsync(30_000); // paused time must not count
    await controller.resume();
    expect(controller.phase).toBe('running');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getSnapshot().elapsedSec).toBe(11);
    expect(controller.getSnapshot().remainingSec).toBe(49);
  });

  it('early stop reports completed=false with real elapsed time', async () => {
    let result: { completed: boolean; actualDurationSec: number } | undefined;
    controller.onComplete = (r) => (result = r);
    await controller.start(config());
    await vi.advanceTimersByTimeAsync(20_000);
    controller.stop();
    expect(controller.phase).toBe('stoppedEarly');
    expect(engine.stop).toHaveBeenCalled();
    expect(result).toMatchObject({ completed: false, actualDurationSec: 20 });
  });

  it('an unexpected context suspension marks the session interrupted', async () => {
    await controller.start(config());
    await vi.advanceTimersByTimeAsync(5_000);
    engine.emitContextState('suspended');
    expect(controller.phase).toBe('interrupted');

    await vi.advanceTimersByTimeAsync(30_000); // interrupted time must not count
    await controller.resume();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getSnapshot().elapsedSec).toBe(6);
  });

  it('a deliberate pause does not read as an interruption', async () => {
    await controller.start(config());
    await controller.pause();
    engine.emitContextState('suspended'); // engine.pause() suspends the ctx
    expect(controller.phase).toBe('paused');
  });

  describe('checkpoints (Phase 3)', () => {
    it('fires at each interval of listening time with a running index', async () => {
      const seen: Array<{ index: number; elapsedSec: number }> = [];
      controller.onCheckpoint = (info) => seen.push(info);
      await controller.start(
        config({ durationSec: 3600, checkpointSec: 600, endGuardSec: 300 }),
      );
      await vi.advanceTimersByTimeAsync(1250_000);
      expect(seen.map((c) => c.index)).toEqual([0, 1]);
      expect(seen[0].elapsedSec).toBe(600);
      expect(seen[1].elapsedSec).toBe(1200);
    });

    it('never fires without checkpointSec configured', async () => {
      const onCheckpoint = vi.fn();
      controller.onCheckpoint = onCheckpoint;
      await controller.start(config({ durationSec: 3600 }));
      await vi.advanceTimersByTimeAsync(2000_000);
      expect(onCheckpoint).not.toHaveBeenCalled();
    });

    it('paused time defers checkpoints', async () => {
      const seen: number[] = [];
      controller.onCheckpoint = (info) => seen.push(info.elapsedSec);
      await controller.start(
        config({ durationSec: 3600, checkpointSec: 600, endGuardSec: 300 }),
      );
      await vi.advanceTimersByTimeAsync(300_000);
      await controller.pause();
      await vi.advanceTimersByTimeAsync(600_000); // paused: no listening time
      expect(seen).toEqual([]);
      await controller.resume();
      await vi.advanceTimersByTimeAsync(301_000);
      expect(seen).toEqual([600]);
    });

    it('skips (but advances past) a checkpoint inside the end guard', async () => {
      const seen: number[] = [];
      controller.onCheckpoint = (info) => seen.push(info.elapsedSec);
      // 900s session: the 600s checkpoint lands with 300s left → guarded out.
      await controller.start(
        config({ durationSec: 900, checkpointSec: 600, endGuardSec: 300 }),
      );
      await vi.advanceTimersByTimeAsync(900_000);
      expect(seen).toEqual([]);
    });

    it('applyProfile only works while running and updates the result config', async () => {
      const profile = STATES.focus.buildProfile(0.9);
      let resultProfile: unknown;
      controller.onComplete = (r) => (resultProfile = r.config.profile);

      controller.applyProfile(profile, 1.0); // idle → no-op
      expect(engine.applyProfile).not.toHaveBeenCalledWith(profile, 1.0);

      await controller.start(config({ durationSec: 60 }));
      controller.applyProfile(profile, 1.0);
      expect(engine.applyProfile).toHaveBeenCalledWith(profile, 1.0);

      await controller.pause();
      engine.applyProfile.mockClear();
      controller.applyProfile(profile, 1.0); // paused → no-op
      expect(engine.applyProfile).not.toHaveBeenCalled();

      await controller.resume();
      await vi.advanceTimersByTimeAsync(61_000);
      expect(resultProfile).toBe(profile);
    });
  });

  describe('session evolution (PRD §12)', () => {
    it('applies the arc ramp-in point on start, then advances toward the plateau', async () => {
      await controller.start(config({ durationSec: 600 }));
      // start() seeds the arc at t=0: the focus arc begins below the plateau.
      expect(engine.setArcModulation).toHaveBeenCalled();
      const first = engine.setArcModulation.mock.calls[0][0];
      expect(first.intensity).toBeCloseTo(0.85);
      expect(first.beatOffsetHz).toBeCloseTo(-2);

      await vi.advanceTimersByTimeAsync(300_000); // mid-session = plateau
      const calls = engine.setArcModulation.mock.calls;
      const last = calls[calls.length - 1][0];
      expect(last.intensity).toBeCloseTo(1);
      expect(last.beatOffsetHz).toBeCloseTo(0);
    });

    it('freezes the arc while paused', async () => {
      await controller.start(config({ durationSec: 600 }));
      await vi.advanceTimersByTimeAsync(10_000);
      await controller.pause();
      engine.setArcModulation.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(engine.setArcModulation).not.toHaveBeenCalled();
    });

    it('never updates the arc during the end fade', async () => {
      await controller.start(config({ durationSec: 60 }));
      await vi.advanceTimersByTimeAsync(58_600); // inside the focus 1.5s fade
      expect(controller.phase).toBe('ending');
      engine.setArcModulation.mockClear();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(engine.setArcModulation).not.toHaveBeenCalled();
    });
  });

  describe('timed programs', () => {
    it('drives program modulation instead of the arc, from t=0', async () => {
      const program = defaultProgram('focus', 0.5);
      await controller.start(config({ durationSec: 30 * 60, program }));
      expect(engine.setProgramModulation).toHaveBeenCalled();
      const seed = engine.setProgramModulation.mock.calls[0][0];
      expect(seed).toEqual(evaluateProgram(program, 0));
      expect(engine.setArcModulation).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(engine.setArcModulation).not.toHaveBeenCalled();
      const calls = engine.setProgramModulation.mock.calls;
      const last = calls[calls.length - 1][0];
      expect(last.rhythm).not.toBeNull();
    });

    it('a plain session clears any leftover program modulation on start', async () => {
      await controller.start(config());
      expect(engine.setProgramModulation).toHaveBeenCalledWith(null);
      expect(engine.setArcModulation).toHaveBeenCalled();
    });

    it('chimes once at each phase boundary when the program asks for it', async () => {
      const program = { ...defaultProgram('focus', 0.5), boundaryChime: true };
      await controller.start(config({ durationSec: 30 * 60, program }));
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 500);
      expect(engine.playCue).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000 + 500); // crosses 3:00
      expect(engine.playCue).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(engine.playCue).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 500); // crosses 8:00
      expect(engine.playCue).toHaveBeenCalledTimes(2);
    });

    it('never cues without boundaryChime', async () => {
      await controller.start(config({ durationSec: 30 * 60, program: defaultProgram('focus', 0.5) }));
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(engine.playCue).not.toHaveBeenCalled();
    });

    it('the end fade still comes from the base state, with no program updates', async () => {
      const program = defaultProgram('focus', 0.5);
      await controller.start(config({ durationSec: 26 * 60, program }));
      await vi.advanceTimersByTimeAsync(26 * 60_000 - 1_400); // inside focus 1.5s fade
      expect(controller.phase).toBe('ending');
      expect(engine.endSession).toHaveBeenCalled();
      engine.setProgramModulation.mockClear();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(engine.setProgramModulation).not.toHaveBeenCalled();
    });
  });
});

describe('SessionController — resume failure, extend, wake-up alarm', () => {
  let engine: ReturnType<typeof stubEngine> & { startAlarm: ReturnType<typeof vi.fn>; stopAlarm: ReturnType<typeof vi.fn> };
  let controller: SessionController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    engine = { ...stubEngine(), startAlarm: vi.fn(), stopAlarm: vi.fn() };
    controller = new SessionController(engine as unknown as AudioEngine);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('a rejected engine.resume() keeps the phase and flags resumeFailed until a resume succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await controller.start(config());
    await controller.pause();
    engine.resume.mockRejectedValueOnce(new Error('InvalidStateError'));
    await expect(controller.resume()).resolves.toBeUndefined();
    expect(controller.phase).toBe('paused');
    expect(controller.getSnapshot().resumeFailed).toBe(true);

    await controller.resume();
    expect(controller.phase).toBe('running');
    expect(controller.getSnapshot().resumeFailed).toBeUndefined();
    warn.mockRestore();
  });

  it('extend() adds time while running', async () => {
    await controller.start(config({ durationSec: 60 }));
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.extend(120);
    expect(controller.getSnapshot().remainingSec).toBe(170);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.phase).toBe('running');
  });

  it('extend() during the wind-down cancels the fade and fades back in', async () => {
    await controller.start(config({ durationSec: 60 }));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(controller.phase).toBe('ending');
    engine.start.mockClear();
    await controller.extend(60);
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(controller.phase).toBe('running');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.phase).toBe('running');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(controller.phase).toBe('finished');
  });

  it('extend() is ignored for program sessions', async () => {
    await controller.start(config({ program: defaultProgram('focus', 0.5), durationSec: 600 }));
    await controller.extend(60);
    expect(controller.getSnapshot().remainingSec).toBe(600);
  });

  it('a wake-up session rings an alarm after the fade instead of finishing', async () => {
    const results: boolean[] = [];
    controller.onComplete = (r) => results.push(r.completed);
    await controller.start(
      config({ state: 'sleep', durationSec: 120, chimeEnabled: false, wakeUp: { riseSec: 30 } }),
    );
    await vi.advanceTimersByTimeAsync(121_000);
    expect(controller.phase).toBe('alarm');
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), false);
    expect(engine.startAlarm).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]);

    controller.dismissAlarm();
    expect(engine.stopAlarm).toHaveBeenCalled();
    expect(controller.phase).toBe('finished');
    expect(results).toEqual([true]);
  });

  it('the alarm gives up after ALARM_MAX_SEC and completes the session', async () => {
    const results: boolean[] = [];
    controller.onComplete = (r) => results.push(r.completed);
    await controller.start(
      config({ state: 'sleep', durationSec: 120, wakeUp: { riseSec: 30 } }),
    );
    await vi.advanceTimersByTimeAsync(121_000);
    expect(controller.phase).toBe('alarm');
    await vi.advanceTimersByTimeAsync(ALARM_MAX_SEC * 1000 + 100);
    expect(controller.phase).toBe('finished');
    expect(results).toEqual([true]);
  });

  it('snooze() plays on for the snooze length, then rings again', async () => {
    await controller.start(
      config({ state: 'sleep', durationSec: 120, wakeUp: { riseSec: 30 } }),
    );
    await vi.advanceTimersByTimeAsync(121_000);
    expect(controller.phase).toBe('alarm');
    engine.startAlarm.mockClear();
    await controller.snooze(60);
    expect(engine.stopAlarm).toHaveBeenCalledWith({ suspend: false });
    expect(controller.phase).toBe('running');
    expect(controller.getSnapshot().remainingSec).toBe(60);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(controller.phase).toBe('alarm');
    expect(engine.startAlarm).toHaveBeenCalledTimes(1);
  });

  it('stop() during the alarm counts as a dismissal (completed)', async () => {
    const results: boolean[] = [];
    controller.onComplete = (r) => results.push(r.completed);
    await controller.start(
      config({ state: 'sleep', durationSec: 120, wakeUp: { riseSec: 30 } }),
    );
    await vi.advanceTimersByTimeAsync(121_000);
    controller.stop();
    expect(controller.phase).toBe('finished');
    expect(results).toEqual([true]);
  });

  describe('open-ended sessions', () => {
    it('never winds down on its own and reports elapsed time, not remaining', async () => {
      await controller.start(config({ durationSec: 0, openEnded: true }));
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(controller.phase).toBe('running');
      expect(engine.endSession).not.toHaveBeenCalled();
      const snap = controller.getSnapshot();
      expect(snap.openEnded).toBe(true);
      expect(snap.elapsedSec).toBe(600);
      expect(snap.remainingSec).toBe(0);
    });

    it('stop() while running is the natural end: a short fade, then finished/completed', async () => {
      const results: boolean[] = [];
      controller.onComplete = (r) => results.push(r.completed);
      await controller.start(config({ durationSec: 0, openEnded: true }));
      await vi.advanceTimersByTimeAsync(90_000);
      controller.stop();
      expect(controller.phase).toBe('ending');
      const [fade, chime] = engine.endSession.mock.calls[0];
      expect(fade).toBeLessThanOrEqual(OPEN_ENDED_STOP_FADE_MAX_SEC);
      expect(chime).toBe(true);
      await vi.advanceTimersByTimeAsync((OPEN_ENDED_STOP_FADE_MAX_SEC + 1) * 1000);
      expect(controller.phase).toBe('finished');
      expect(results).toEqual([true]);
    });

    it('stop() while paused still completes rather than counting as an early stop', async () => {
      const results: boolean[] = [];
      controller.onComplete = (r) => results.push(r.completed);
      await controller.start(config({ durationSec: 0, openEnded: true }));
      await vi.advanceTimersByTimeAsync(30_000);
      await controller.pause();
      controller.stop();
      expect(controller.phase).toBe('finished');
      expect(results).toEqual([true]);
    });

    it('keeps firing checkpoints — there is no end guard to run into', async () => {
      const seen: number[] = [];
      controller.onCheckpoint = (info) => seen.push(info.index);
      await controller.start(
        config({ durationSec: 0, openEnded: true, checkpointSec: 60, endGuardSec: 300 }),
      );
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 500);
      expect(seen).toEqual([0, 1, 2, 3, 4]);
    });

    it('ignores extend()', async () => {
      await controller.start(config({ durationSec: 0, openEnded: true }));
      await controller.extend(900);
      expect(controller.getSnapshot().remainingSec).toBe(0);
    });

    it('holds the arc at its plateau instead of easing down', async () => {
      await controller.start(config({ durationSec: 0, openEnded: true }));
      await vi.advanceTimersByTimeAsync(40 * 60_000);
      const arc = resolveArc('focus', { durationSec: 0 });
      const last = engine.setArcModulation.mock.calls.at(-1)![0];
      expect(last).toEqual(evaluateArc(arc, ARC_PLATEAU_T));
    });
  });
});

describe('windDown (sleep-onset fade, Phase 9)', () => {
  let engine: ReturnType<typeof stubEngine>;
  let controller: SessionController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    engine = stubEngine();
    controller = new SessionController(engine as unknown as AudioEngine);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('ends a running sleep session as completed with the sleep fade, no chime', async () => {
    const results: Array<{ completed: boolean; woundDownAtSec?: number }> = [];
    controller.onComplete = (r) =>
      results.push({ completed: r.completed, woundDownAtSec: r.woundDownAtSec });
    await controller.start(
      config({ state: 'sleep', durationSec: 60 * 60, profile: STATES.sleep.buildProfile(0.5) }),
    );
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(controller.windDown()).toBe(true);
    expect(controller.getSnapshot().windingDown).toBe(true);
    expect(controller.getSnapshot().phase).toBe('ending');
    // endSession got sleep's long fade and no chime.
    const [fadeSeconds, chime] = engine.endSession.mock.calls.at(-1)!;
    expect(fadeSeconds).toBeCloseTo(STATES.sleep.end.fadeSeconds, 0);
    expect(chime).toBe(false);
    await vi.advanceTimersByTimeAsync((STATES.sleep.end.fadeSeconds + 1) * 1000);
    expect(results).toEqual([{ completed: true, woundDownAtSec: 15 * 60 }]);
  });

  it('is refused for programs, wake-up, open-ended, near the end, and when not running', async () => {
    await controller.start(
      config({ state: 'sleep', durationSec: 60 * 60, profile: STATES.sleep.buildProfile(0.5), wakeUp: { riseSec: 300 } }),
    );
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(controller.windDown()).toBe(false);
    controller.stop();

    await controller.start(config({ program: defaultProgram('sleep', 0.5), durationSec: 60 * 60 }));
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(controller.windDown()).toBe(false);
    controller.stop();

    await controller.start(config({ openEnded: true }));
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(controller.windDown()).toBe(false);
    controller.stop();

    // Near the end: the fade already owns the finish.
    await controller.start(config({ state: 'sleep', durationSec: 90, profile: STATES.sleep.buildProfile(0.5) }));
    await vi.advanceTimersByTimeAsync(45 * 1000);
    expect(controller.windDown()).toBe(false);

    // Paused sessions are refused too.
    await vi.advanceTimersByTimeAsync(1000);
    await controller.pause();
    expect(controller.windDown()).toBe(false);
  });

  it('the +extend escape hatch cancels a wind-down fade', async () => {
    const results: boolean[] = [];
    controller.onComplete = (r) => results.push(r.completed);
    await controller.start(
      config({ state: 'sleep', durationSec: 60 * 60, profile: STATES.sleep.buildProfile(0.5) }),
    );
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(controller.windDown()).toBe(true);
    expect(controller.getSnapshot().phase).toBe('ending');
    await controller.extend(15 * 60);
    expect(controller.getSnapshot().phase).toBe('running');
    expect(results).toEqual([]);
  });
});

describe('pause tracking (PRD §9 implicit signal)', () => {
  let engine: ReturnType<typeof stubEngine>;
  let controller: SessionController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    engine = stubEngine();
    controller = new SessionController(engine as unknown as AudioEngine);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('reports user pauses and total paused time in the result', async () => {
    const results: Array<{ pauseCount?: number; pausedSec?: number }> = [];
    controller.onComplete = (r) =>
      results.push({ pauseCount: r.pauseCount, pausedSec: r.pausedSec });
    await controller.start(config({ durationSec: 120 }));
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.pause();
    await vi.advanceTimersByTimeAsync(30_000);
    await controller.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.pause();
    await vi.advanceTimersByTimeAsync(15_000);
    controller.stop(); // stopping while paused still settles the open span
    expect(results).toHaveLength(1);
    expect(results[0].pauseCount).toBe(2);
    expect(results[0].pausedSec).toBeGreaterThanOrEqual(44);
    expect(results[0].pausedSec).toBeLessThanOrEqual(46);
  });

  it('leaves the fields absent with no pauses and ignores interruptions', async () => {
    const results: Array<{ pauseCount?: number }> = [];
    controller.onComplete = (r) => results.push({ pauseCount: r.pauseCount });
    await controller.start(config({ durationSec: 30 }));
    // An external interruption is not a user pause.
    engine.emitContextState('suspended');
    expect(controller.getSnapshot().phase).toBe('interrupted');
    await controller.resume();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(results).toHaveLength(1);
    expect(results[0].pauseCount).toBeUndefined();
  });
});

describe('routine hand-off (Phase 14)', () => {
  let engine: ReturnType<typeof stubEngine>;
  let controller: SessionController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    engine = stubEngine();
    controller = new SessionController(engine as unknown as AudioEngine);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('a handOff leg ends without the end fade, and continueWith carries straight on', async () => {
    const results: SessionResult[] = [];
    const relax = config({ state: 'relax', durationSec: 120, profile: STATES.relax.buildProfile(0.4) });
    controller.onComplete = (r) => {
      results.push(r);
      if (r.handOff) controller.continueWith(relax);
    };
    await controller.start(config({ durationSec: 60, handOff: true }));
    await vi.advanceTimersByTimeAsync(61_000);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ completed: true, handOff: true, actualDurationSec: 60 });
    expect(results[0].config.state).toBe('focus');
    // No fade-out, no engine restart: the sound glides into the next leg.
    expect(engine.endSession).not.toHaveBeenCalled();
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.applyProfile).toHaveBeenLastCalledWith(relax.profile, ADAPT_RAMP_TIME_CONSTANT, {
      typeFadeSec: PROGRAM_TYPE_FADE_SEC,
    });
    expect(controller.phase).toBe('running');
    // The new leg's clock started at the hand-off (~1 s ago).
    expect(controller.getSnapshot().elapsedSec).toBeLessThanOrEqual(1);
    expect(controller.getSnapshot().remainingSec).toBeGreaterThanOrEqual(119);

    // The last leg ends like any session.
    await vi.advanceTimersByTimeAsync(121_000);
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ completed: true, actualDurationSec: 120 });
    expect(results[1].handOff).toBeUndefined();
    expect(results[1].config.state).toBe('relax');
    expect(engine.endSession).toHaveBeenCalledTimes(1);
  });

  it('a leg that hands off resets the per-leg counters', async () => {
    const results: SessionResult[] = [];
    controller.onComplete = (r) => {
      results.push(r);
      if (r.handOff) controller.continueWith(config({ durationSec: 60 }));
    };
    await controller.start(config({ durationSec: 60, handOff: true }));
    await controller.pause();
    await controller.resume();
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(results[0].pauseCount).toBe(1);
    expect(results[1].pauseCount).toBeUndefined();
  });

  it('fades out on its own if nobody continues — never plays on unattended', async () => {
    const results: SessionResult[] = [];
    controller.onComplete = (r) => results.push(r);
    await controller.start(config({ durationSec: 60, handOff: true }));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(results).toHaveLength(1);
    expect(engine.endSession).toHaveBeenCalledTimes(1);
    expect(controller.phase).toBe('finished');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(results).toHaveLength(1); // the leg's result is never emitted twice
  });

  it('continueWith is ignored unless a leg is running', () => {
    controller.continueWith(config());
    expect(engine.applyProfile).not.toHaveBeenCalled();
  });
});

describe('wakeNow (smart wake, Phase 16)', () => {
  let engine: ReturnType<typeof stubEngine> & {
    startAlarm: ReturnType<typeof vi.fn>;
    stopAlarm: ReturnType<typeof vi.fn>;
  };
  let controller: SessionController;
  const sleepWithWakeUp = () =>
    config({
      state: 'sleep',
      durationSec: 8 * 60 * 60,
      profile: STATES.sleep.buildProfile(0.5),
      wakeUp: { riseSec: 10 * 60 },
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    engine = { ...stubEngine(), startAlarm: vi.fn(), stopAlarm: vi.fn() };
    controller = new SessionController(engine as unknown as AudioEngine);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('starts the rise now: the arc reaches its wake-up knee here and the alarm rings a rise later', async () => {
    const results: Array<{ completed: boolean; smartWakeAtSec?: number; actualDurationSec: number }> = [];
    controller.onComplete = (r) =>
      results.push({ completed: r.completed, smartWakeAtSec: r.smartWakeAtSec, actualDurationSec: r.actualDurationSec });
    await controller.start(sleepWithWakeUp());
    const at = 7 * 60 * 60 + 35 * 60; // 25 min before the planned end
    await vi.advanceTimersByTimeAsync(at * 1000);
    expect(controller.wakeNow()).toBe(true);
    expect(controller.getSnapshot().remainingSec).toBe(10 * 60);
    // The arc is now evaluated on the shortened session, right at the knee.
    const arc = resolveArc('sleep', { wakeUp: { riseSec: 10 * 60 }, durationSec: at + 10 * 60 });
    expect(engine.setArcModulation).toHaveBeenLastCalledWith(
      evaluateArc(arc, at / (at + 10 * 60)),
      expect.any(Number),
    );
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    expect(engine.startAlarm).toHaveBeenCalledTimes(1);
    controller.dismissAlarm();
    expect(results).toEqual([{ completed: true, smartWakeAtSec: at, actualDurationSec: at + 10 * 60 }]);
  });

  it('is refused without a wake-up, once the rise is under way, and when not running', async () => {
    await controller.start(config({ state: 'sleep', durationSec: 60 * 60, profile: STATES.sleep.buildProfile(0.5) }));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(controller.wakeNow()).toBe(false);
    controller.stop();

    await controller.start(sleepWithWakeUp());
    await vi.advanceTimersByTimeAsync((8 * 60 * 60 - 5 * 60) * 1000); // inside the planned rise
    expect(controller.wakeNow()).toBe(false);
    controller.stop();

    await controller.start(sleepWithWakeUp());
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await controller.pause();
    expect(controller.wakeNow()).toBe(false);
  });

  it('snooze still works after a smart wake', async () => {
    await controller.start(sleepWithWakeUp());
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(controller.wakeNow()).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    expect(controller.getSnapshot().phase).toBe('alarm');
    await controller.snooze();
    expect(controller.getSnapshot().phase).toBe('running');
    expect(controller.getSnapshot().remainingSec).toBeGreaterThan(4 * 60);
  });
});
