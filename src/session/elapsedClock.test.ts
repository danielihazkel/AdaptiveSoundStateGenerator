import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElapsedClock } from './elapsedClock';

describe('ElapsedClock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts wall-clock time while running', () => {
    const clock = new ElapsedClock();
    clock.start();
    vi.advanceTimersByTime(5_000);
    expect(clock.elapsedMs()).toBe(5_000);
  });

  it('freezes while paused and excludes the gap after resume', () => {
    const clock = new ElapsedClock();
    clock.start();
    vi.advanceTimersByTime(5_000);
    clock.pause();
    vi.advanceTimersByTime(30_000);
    expect(clock.elapsedMs()).toBe(5_000);
    clock.resume();
    vi.advanceTimersByTime(2_000);
    expect(clock.elapsedMs()).toBe(7_000);
  });

  it('pause and resume are idempotent', () => {
    const clock = new ElapsedClock();
    clock.start();
    vi.advanceTimersByTime(1_000);
    clock.pause();
    clock.pause();
    vi.advanceTimersByTime(1_000);
    expect(clock.elapsedMs()).toBe(1_000);
    clock.resume();
    clock.resume();
    vi.advanceTimersByTime(1_000);
    expect(clock.elapsedMs()).toBe(2_000);
  });

  it('start resets accumulated time', () => {
    const clock = new ElapsedClock();
    clock.start();
    vi.advanceTimersByTime(9_000);
    clock.start();
    vi.advanceTimersByTime(1_000);
    expect(clock.elapsedMs()).toBe(1_000);
  });
});
