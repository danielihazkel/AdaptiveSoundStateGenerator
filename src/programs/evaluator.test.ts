import { describe, expect, it } from 'vitest';
import { SEGMENT_CROSSFADE_SEC, evaluateProgram, segmentAt } from './evaluator';
import { defaultProgram, normalizeProgram, type Program } from './types';

const program = defaultProgram('focus', 0.5);
// Phases: 0–3 warm 70–80, 3–8 pulse 85–90, 8–15 build 90–100,
// 15–25 peak 95–110, 25+ sustain 90–105.

function twoPhase(): Program {
  return normalizeProgram({
    segments: [
      {
        startMin: 0,
        endMin: 10,
        intensity: 0.3,
        bpmRange: [70, 80],
        complexity: 0.1,
        noiseScale: 0.5,
      },
      { startMin: 10, endMin: null, intensity: 0.9, bpmRange: [100, 110], complexity: 0.8 },
    ],
  });
}

describe('evaluateProgram', () => {
  it('is deterministic in elapsed time', () => {
    for (const t of [0, 90, 8 * 60, 40 * 60]) {
      expect(evaluateProgram(program, t)).toEqual(evaluateProgram(program, t));
    }
  });

  it('always returns a rhythm target — programs own the pulse', () => {
    for (let t = 0; t <= 40 * 60; t += 30) {
      expect(evaluateProgram(program, t).rhythm).not.toBeNull();
    }
  });

  it('defaults harmony/bass scales to 1 and warmth to null when segments omit them', () => {
    for (const t of [0, 5 * 60, 30 * 60]) {
      const m = evaluateProgram(program, t);
      expect(m.harmonyScale).toBe(1);
      expect(m.bassScale).toBe(1);
      expect(m.warmth).toBeNull();
    }
  });

  it('blends warmth and harmony continuously when both segments set them', () => {
    const p = normalizeProgram({
      segments: [
        { startMin: 0, endMin: 10, bpmRange: [70, 80], harmonyScale: 0.8, warmth: 0.9, bassScale: 0.8 },
        { startMin: 10, endMin: null, bpmRange: [90, 100], harmonyScale: 1.4, warmth: 0.7, bassScale: 1.3 },
      ],
    });
    expect(evaluateProgram(p, 5 * 60).warmth).toBeCloseTo(0.9);
    expect(evaluateProgram(p, 20 * 60).warmth).toBeCloseTo(0.7);
    let prev = evaluateProgram(p, 10 * 60 - SEGMENT_CROSSFADE_SEC);
    for (
      let t = 10 * 60 - SEGMENT_CROSSFADE_SEC + 1;
      t <= 10 * 60 + SEGMENT_CROSSFADE_SEC;
      t += 1
    ) {
      const next = evaluateProgram(p, t);
      expect(Math.abs(next.warmth! - prev.warmth!)).toBeLessThan(0.02);
      expect(Math.abs(next.harmonyScale - prev.harmonyScale)).toBeLessThan(0.05);
      expect(Math.abs(next.bassScale - prev.bassScale)).toBeLessThan(0.05);
      prev = next;
    }
  });

  it('takes the overriding side when only one crossfade neighbor sets warmth', () => {
    const p = normalizeProgram({
      segments: [
        { startMin: 0, endMin: 10, bpmRange: [70, 80] },
        { startMin: 10, endMin: null, bpmRange: [90, 100], warmth: 0.7 },
      ],
    });
    expect(evaluateProgram(p, 5 * 60).warmth).toBeNull();
    expect(evaluateProgram(p, 10 * 60).warmth).toBe(0.7);
    expect(evaluateProgram(p, 20 * 60).warmth).toBe(0.7);
  });

  it('keeps bpm within the active segment range away from boundaries', () => {
    // Sample deep inside each segment (outside every crossfade window).
    const cases: Array<[number, number, number]> = [
      [90, 70, 80],
      [5.5 * 60, 85, 90],
      [11.5 * 60, 90, 100],
      [20 * 60, 95, 110],
      [40 * 60, 90, 105],
    ];
    for (const [t, min, max] of cases) {
      const bpm = evaluateProgram(program, t).rhythm!.bpm;
      expect(bpm).toBeGreaterThanOrEqual(min - 1e-9);
      expect(bpm).toBeLessThanOrEqual(max + 1e-9);
    }
  });

  it('is continuous across segment boundaries', () => {
    const p = twoPhase();
    // Dense sweep across the 10-minute boundary; adjacent samples must never
    // jump — the crossfade plus drift keeps everything smooth.
    let prev = evaluateProgram(p, 10 * 60 - SEGMENT_CROSSFADE_SEC);
    for (
      let t = 10 * 60 - SEGMENT_CROSSFADE_SEC + 1;
      t <= 10 * 60 + SEGMENT_CROSSFADE_SEC;
      t += 1
    ) {
      const next = evaluateProgram(p, t);
      expect(Math.abs(next.intensity - prev.intensity)).toBeLessThan(0.05);
      expect(Math.abs(next.noiseScale - prev.noiseScale)).toBeLessThan(0.05);
      expect(Math.abs(next.rhythm!.bpm - prev.rhythm!.bpm)).toBeLessThan(3);
      expect(Math.abs(next.rhythm!.complexity - prev.rhythm!.complexity)).toBeLessThan(0.06);
      prev = next;
    }
  });

  it('reaches each side\'s plain values outside the crossfade window', () => {
    const p = twoPhase();
    expect(evaluateProgram(p, 5 * 60).intensity).toBeCloseTo(0.3);
    expect(evaluateProgram(p, 5 * 60).noiseScale).toBeCloseTo(0.5);
    expect(evaluateProgram(p, 20 * 60).intensity).toBeCloseTo(0.9);
    expect(evaluateProgram(p, 20 * 60).noiseScale).toBeCloseTo(1);
  });

  it('holds the open-ended last segment with gentle drift forever', () => {
    const p = twoPhase();
    const samples = [];
    for (let t = 30 * 60; t <= 120 * 60; t += 60) {
      const m = evaluateProgram(p, t);
      expect(m.intensity).toBeCloseTo(0.9);
      samples.push(m.rhythm!.bpm);
      expect(m.rhythm!.bpm).toBeGreaterThanOrEqual(100);
      expect(m.rhythm!.bpm).toBeLessThanOrEqual(110);
    }
    // Still varying, not frozen.
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(1);
  });
});

describe('segmentAt', () => {
  it('reports the active segment, its index, and the countdown', () => {
    const first = segmentAt(program, 60);
    expect(first.index).toBe(0);
    expect(first.segment.label).toBe('Warm-up');
    expect(first.nextIn).toBe(2 * 60);

    const build = segmentAt(program, 9 * 60);
    expect(build.index).toBe(2);
    expect(build.nextIn).toBe(6 * 60);
  });

  it('returns null countdown inside the open-ended sustain', () => {
    const sustain = segmentAt(program, 60 * 60);
    expect(sustain.index).toBe(4);
    expect(sustain.nextIn).toBeNull();
  });
});
