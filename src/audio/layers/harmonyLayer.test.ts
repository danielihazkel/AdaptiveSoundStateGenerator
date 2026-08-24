import { describe, expect, it } from 'vitest';
import { harmonyVoiceAmps } from './harmonyLayer';

describe('harmonyVoiceAmps', () => {
  it('is root-only at richness 0', () => {
    expect(harmonyVoiceAmps(0)).toEqual({ root: 1, fifth: 0, octave: 0, third: 0 });
  });

  it('fades upper voices in monotonically relative to the root', () => {
    // Absolute amplitudes may dip slightly as later voices join (equal-power
    // conservation); what must grow monotonically is each voice's share.
    let prev = harmonyVoiceAmps(0);
    for (let r = 0.05; r <= 1.000001; r += 0.05) {
      const amps = harmonyVoiceAmps(r);
      expect(amps.fifth / amps.root).toBeGreaterThanOrEqual(prev.fifth / prev.root - 1e-9);
      expect(amps.octave / amps.root).toBeGreaterThanOrEqual(prev.octave / prev.root - 1e-9);
      expect(amps.third / amps.root).toBeGreaterThanOrEqual(prev.third / prev.root - 1e-9);
      prev = amps;
    }
    const full = harmonyVoiceAmps(1);
    expect(full.fifth).toBeGreaterThan(0);
    expect(full.octave).toBeGreaterThan(0);
    expect(full.third).toBeGreaterThan(0);
  });

  it('stays equal-power at every richness (sum of squares = 1)', () => {
    for (let r = 0; r <= 1.000001; r += 0.01) {
      const a = harmonyVoiceAmps(r);
      const energy = a.root ** 2 + a.fifth ** 2 + a.octave ** 2 + a.third ** 2;
      expect(energy).toBeCloseTo(1, 10);
    }
  });

  it('is continuous in richness — no voicing jumps', () => {
    let prev = harmonyVoiceAmps(0);
    for (let r = 0.01; r <= 1.000001; r += 0.01) {
      const amps = harmonyVoiceAmps(r);
      for (const voice of ['root', 'fifth', 'octave', 'third'] as const) {
        expect(Math.abs(amps[voice] - prev[voice])).toBeLessThan(0.05);
      }
      prev = amps;
    }
  });

  it('clamps richness outside 0..1', () => {
    expect(harmonyVoiceAmps(-1)).toEqual(harmonyVoiceAmps(0));
    expect(harmonyVoiceAmps(2)).toEqual(harmonyVoiceAmps(1));
  });
});
