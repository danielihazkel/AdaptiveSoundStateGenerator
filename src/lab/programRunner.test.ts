import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../audio/engine';
import { defaultProgram, normalizeProgram, type Program } from '../programs/types';
import { LabProgramRunner } from './programRunner';

function stubEngine() {
  return {
    setProgramModulation: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(),
  };
}

/** A 1-minute fully closed focus program. */
function closedProgram(overrides: Partial<Program> = {}): Program {
  return normalizeProgram({
    baseState: 'focus',
    segments: [
      { startMin: 0, endMin: 1, label: 'Only', intensity: 0.5, bpmRange: [70, 80], complexity: 0 },
    ],
    ...overrides,
  });
}

describe('LabProgramRunner', () => {
  let engine: ReturnType<typeof stubEngine>;
  let runner: LabProgramRunner;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    engine = stubEngine();
    runner = new LabProgramRunner();
  });

  afterEach(() => {
    runner.dispose();
    vi.useRealTimers();
  });

  const start = (program: Program) => runner.start(program, engine as unknown as AudioEngine);

  it('runs a closed program to completion: ending at T - fadeSeconds, then finished', async () => {
    await start(closedProgram());
    expect(runner.getSnapshot()).toMatchObject({ status: 'running', totalSec: 60 });
    expect(engine.setProgramModulation).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(57_000);
    expect(runner.status).toBe('running');

    // focus end fade is 1.5s → 'ending' within one tick of T-1.5s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runner.status).toBe('ending');
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(runner.status).toBe('finished');
    expect(engine.setProgramModulation).toHaveBeenLastCalledWith(null);
  });

  it('resolves the chime from the base state and the program override', async () => {
    // sleep never chimes by default (60s fade → ending starts immediately on a 1-min program)
    await start(closedProgram({ baseState: 'sleep' }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), false);
    runner.stop();

    engine.endSession.mockClear();
    await start(closedProgram({ baseState: 'sleep', endChime: true }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.endSession).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('pause freezes the clock and modulation; resume continues from the same point', async () => {
    await start(closedProgram());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runner.getSnapshot().elapsedSec).toBe(10);

    await runner.pause();
    expect(engine.pause).toHaveBeenCalled();
    const calls = engine.setProgramModulation.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runner.getSnapshot()).toMatchObject({ status: 'paused', elapsedSec: 10 });
    expect(engine.setProgramModulation.mock.calls.length).toBe(calls);

    await runner.resume();
    expect(engine.resume).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runner.getSnapshot()).toMatchObject({ status: 'running', elapsedSec: 12 });
  });

  it('an open-ended final segment never auto-ends', async () => {
    // defaultProgram's last segment is open ("25+"); closed duration is 25 min
    await start(defaultProgram('focus', 0.5));
    expect(runner.getSnapshot().totalSec).toBeNull();

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(runner.status).toBe('running');
    expect(runner.getSnapshot().elapsedSec).toBe(30 * 60);
    expect(engine.endSession).not.toHaveBeenCalled();
  });

  it('stop fades the engine, clears the modulation channel, and resets', async () => {
    await start(closedProgram());
    await vi.advanceTimersByTimeAsync(5_000);
    runner.stop();

    expect(engine.stop).toHaveBeenCalled();
    expect(engine.setProgramModulation).toHaveBeenLastCalledWith(null);
    expect(runner.getSnapshot()).toMatchObject({ status: 'idle', elapsedSec: 0, program: null });

    // no ticks keep firing after stop
    const calls = engine.setProgramModulation.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.setProgramModulation.mock.calls.length).toBe(calls);
  });
});
