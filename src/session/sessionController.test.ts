import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../audio/engine';
import { STATES } from '../audio/states';
import { evaluateProgram } from '../programs/evaluator';
import { defaultProgram } from '../programs/types';
import { SessionController, type SessionConfig } from './sessionController';

function stubEngine() {
  return {
    onContextStateChange: undefined as ((state: AudioContextState) => void) | undefined,
    applyProfile: vi.fn(),
    setArcModulation: vi.fn(),
    setProgramModulation: vi.fn(),
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
    engine.onContextStateChange?.('suspended');
    expect(controller.phase).toBe('interrupted');

    await vi.advanceTimersByTimeAsync(30_000); // interrupted time must not count
    await controller.resume();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getSnapshot().elapsedSec).toBe(6);
  });

  it('a deliberate pause does not read as an interruption', async () => {
    await controller.start(config());
    await controller.pause();
    engine.onContextStateChange?.('suspended'); // engine.pause() suspends the ctx
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
