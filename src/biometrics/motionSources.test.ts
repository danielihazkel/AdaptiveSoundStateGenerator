// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionSample } from './motion';
import { DeviceMotionSource, SimulatedMotionSource } from './motionSources';

function motionEvent(init: {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity?: { x: number; y: number; z: number } | null;
}): Event {
  return Object.assign(new Event('devicemotion'), {
    acceleration: init.acceleration ?? null,
    accelerationIncludingGravity: init.accelerationIncludingGravity ?? null,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).DeviceMotionEvent;
});

describe('DeviceMotionSource', () => {
  it('folds raw events into 1 s epochs of mean gravity-free acceleration', async () => {
    (window as unknown as Record<string, unknown>).DeviceMotionEvent = class {};
    const source = new DeviceMotionSource();
    const epochs: MotionSample[] = [];
    source.subscribe((s) => epochs.push(s));
    await source.start();
    expect(source.getStatus()).toBe('connecting');
    for (let i = 0; i <= 10; i++) {
      window.dispatchEvent(motionEvent({ acceleration: { x: 0.3, y: 0.4, z: 0 } }));
      vi.advanceTimersByTime(100);
    }
    expect(source.getStatus()).toBe('connected');
    expect(epochs).toHaveLength(1);
    expect(epochs[0].activity).toBeCloseTo(0.5, 6);
    source.stop();
    expect(source.getStatus()).toBe('disconnected');
  });

  it('asks iOS for permission and reports a refusal', async () => {
    (window as unknown as Record<string, unknown>).DeviceMotionEvent = {
      requestPermission: vi.fn(async () => 'denied'),
    };
    const source = new DeviceMotionSource();
    await source.start();
    expect(source.getStatus()).toBe('error');
  });

  it('a device that never fires is unavailable', async () => {
    (window as unknown as Record<string, unknown>).DeviceMotionEvent = class {};
    const source = new DeviceMotionSource();
    await source.start();
    vi.advanceTimersByTime(5000);
    expect(source.getStatus()).toBe('unavailable');
  });

  it('high-passes gravity when the browser only reports it included', async () => {
    (window as unknown as Record<string, unknown>).DeviceMotionEvent = class {};
    const source = new DeviceMotionSource();
    const epochs: MotionSample[] = [];
    source.subscribe((s) => epochs.push(s));
    await source.start();
    // A phone lying flat and still: gravity only — reads as no movement.
    for (let i = 0; i <= 20; i++) {
      window.dispatchEvent(motionEvent({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } }));
      vi.advanceTimersByTime(100);
    }
    expect(epochs.length).toBeGreaterThan(0);
    expect(epochs.every((e) => e.activity < 1e-9)).toBe(true);
  });
});

describe('SimulatedMotionSource', () => {
  it('settling: bursts while tossing, then a quiet floor', async () => {
    const source = new SimulatedMotionSource({ mode: 'settling', rng: () => 0.5 });
    const epochs: MotionSample[] = [];
    source.subscribe((s) => epochs.push(s));
    await source.start();
    vi.advanceTimersByTime(10 * 60_000);
    source.stop();
    const early = epochs.slice(0, 60).filter((e) => e.activity > 0.3).length;
    const late = epochs.slice(-60).filter((e) => e.activity > 0.3).length;
    expect(early).toBeGreaterThan(0);
    expect(late).toBe(0);
  });
});
