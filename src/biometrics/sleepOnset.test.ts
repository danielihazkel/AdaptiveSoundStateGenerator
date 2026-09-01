import { describe, expect, it } from 'vitest';
import { detectSleepOnset, SLEEP_ONSET_DEFAULTS } from './sleepOnset';
import type { BiometricSample } from './types';

const START = 1_000_000_000;

/** 1 Hz samples driven by a bpm(minute) curve, with tiny deterministic wobble. */
function series(minutes: number, bpmAt: (minute: number) => number): BiometricSample[] {
  const out: BiometricSample[] = [];
  for (let i = 0; i < minutes * 60; i++) {
    const minute = i / 60;
    out.push({
      heartRateBpm: Math.round(bpmAt(minute) + ((i * 7) % 3) - 1), // ±1 wobble
      timestamp: START + i * 1000,
    });
  }
  return out;
}

const at = (samples: BiometricSample[]) => samples[samples.length - 1].timestamp + 1000;

describe('detectSleepOnset', () => {
  it('never fires on a flat, awake heart rate', () => {
    const samples = series(30, () => 64);
    expect(detectSleepOnset(samples, { now: at(samples) }).onset).toBe(false);
  });

  it('fires once a gradual drop has been sustained and steady', () => {
    // 64 bpm baseline, sliding to 55 by minute 10, flat after.
    const samples = series(20, (m) => (m < 10 ? 64 - (9 * m) / 10 : 55));
    const result = detectSleepOnset(samples, { now: at(samples) });
    expect(result.onset).toBe(true);
    expect(result.deltaBpm).toBeGreaterThan(5);
    // …but not while the drop is still under way at minute 11.
    const early = samples.filter((s) => s.timestamp < START + 11 * 60_000);
    expect(detectSleepOnset(early, { now: at(early) }).onset).toBe(false);
  });

  it('does not fire when the rate drops but comes back up (roused)', () => {
    const samples = series(25, (m) => (m < 10 ? 64 : m < 18 ? 55 : 63));
    expect(detectSleepOnset(samples, { now: at(samples) }).onset).toBe(false);
  });

  it('does not fire when the recent rate is low but swinging (restless)', () => {
    const samples = series(25, (m) =>
      m < 10 ? 64 : 54 + 5 * Math.sin(m * 2 * Math.PI), // ±5 bpm swings
    );
    expect(detectSleepOnset(samples, { now: at(samples) }).onset).toBe(false);
  });

  it('needs the minimum elapsed time and a live sensor', () => {
    const short = series(8, (m) => (m < 2 ? 64 : 54));
    expect(detectSleepOnset(short, { now: at(short) }).onset).toBe(false);

    const stale = series(20, (m) => (m < 10 ? 64 : 55));
    expect(
      detectSleepOnset(stale, {
        now: at(stale) + SLEEP_ONSET_DEFAULTS.staleMs + 60_000,
      }).onset,
    ).toBe(false);

    expect(detectSleepOnset([], { now: START }).onset).toBe(false);
  });

  it('a movement veto blocks the verdict (stillness seam)', () => {
    const samples = series(20, (m) => (m < 10 ? 64 : 55));
    expect(detectSleepOnset(samples, { now: at(samples), stillness: false }).onset).toBe(false);
    expect(detectSleepOnset(samples, { now: at(samples), stillness: true }).onset).toBe(true);
  });
});
