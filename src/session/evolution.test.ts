import { describe, expect, it } from 'vitest';
import { STATE_LIST } from '../audio/states';
import {
  evaluateArc,
  IDENTITY_MODULATION,
  resolveArc,
  STATE_ARCS,
  WAKE_UP_TARGET,
  withWakeUp,
  type ArcDefinition,
} from './evolution';

const T_GRID = Array.from({ length: 101 }, (_, i) => i / 100);

describe('evaluateArc', () => {
  const def: ArcDefinition = {
    intensity: {
      points: [
        { at: 0, value: 0.8 },
        { at: 0.5, value: 1 },
      ],
    },
    beatOffsetHz: { points: [{ at: 0, value: -2 }] },
    lowpassScale: { points: [] },
  };

  it('returns endpoint values at and beyond the track edges', () => {
    expect(evaluateArc(def, 0).intensity).toBe(0.8);
    expect(evaluateArc(def, 0.5).intensity).toBe(1);
    expect(evaluateArc(def, 1).intensity).toBe(1); // past last point: clamped
  });

  it('clamps t outside 0..1', () => {
    expect(evaluateArc(def, -5)).toEqual(evaluateArc(def, 0));
    expect(evaluateArc(def, 7)).toEqual(evaluateArc(def, 1));
  });

  it('smoothstep-eases between points (midpoint is halfway, edges flat)', () => {
    expect(evaluateArc(def, 0.25).intensity).toBeCloseTo(0.9); // smoothstep(0.5) = 0.5
    // Near a point the ease is flat: barely off the endpoint value.
    expect(evaluateArc(def, 0.02).intensity).toBeCloseTo(0.8, 2);
  });

  it('single-point and empty tracks are constant', () => {
    expect(evaluateArc(def, 0.9).beatOffsetHz).toBe(-2);
    expect(evaluateArc(def, 0.9).lowpassScale).toBe(1); // empty track = identity
  });

  it('identity modulation is the neutral element', () => {
    expect(IDENTITY_MODULATION).toEqual({ intensity: 1, beatOffsetHz: 0, lowpassScale: 1 });
  });
});

describe('STATE_ARCS', () => {
  it('every state arc stays inside safe modulation bounds across the session', () => {
    for (const { id: state } of STATE_LIST) {
      for (const t of T_GRID) {
        const mod = evaluateArc(STATE_ARCS[state], t);
        expect(mod.intensity).toBeGreaterThanOrEqual(0.6);
        expect(mod.intensity).toBeLessThanOrEqual(1.05);
        expect(Math.abs(mod.beatOffsetHz)).toBeLessThanOrEqual(4);
        expect(mod.lowpassScale).toBeGreaterThan(0);
        expect(mod.lowpassScale).toBeLessThanOrEqual(1);
      }
    }
  });

  it('track points are sorted ascending in t', () => {
    for (const { id: state } of STATE_LIST) {
      const def = STATE_ARCS[state];
      for (const track of [def.intensity, def.beatOffsetHz, def.lowpassScale]) {
        for (let i = 1; i < track.points.length; i++) {
          expect(track.points[i].at).toBeGreaterThan(track.points[i - 1].at);
        }
      }
    }
  });

  it('sleep only ever descends — darker, slower, softer, no rise', () => {
    let prev = evaluateArc(STATE_ARCS.sleep, 0);
    for (const t of T_GRID.slice(1)) {
      const mod = evaluateArc(STATE_ARCS.sleep, t);
      expect(mod.intensity).toBeLessThanOrEqual(prev.intensity + 1e-9);
      expect(mod.beatOffsetHz).toBeLessThanOrEqual(prev.beatOffsetHz + 1e-9);
      expect(mod.lowpassScale).toBeLessThanOrEqual(prev.lowpassScale + 1e-9);
      prev = mod;
    }
  });

  it('focus ramps in below the plateau and eases down at the end (PRD §12 shape)', () => {
    const start = evaluateArc(STATE_ARCS.focus, 0);
    const mid = evaluateArc(STATE_ARCS.focus, 0.5);
    const end = evaluateArc(STATE_ARCS.focus, 1);
    expect(start.intensity).toBeLessThan(mid.intensity);
    expect(start.beatOffsetHz).toBeLessThan(mid.beatOffsetHz);
    expect(mid.beatOffsetHz).toBeCloseTo(0); // plateau plays the base profile
    expect(end.intensity).toBeLessThan(mid.intensity);
    expect(end.beatOffsetHz).toBeLessThan(mid.beatOffsetHz);
  });
});

describe('withWakeUp / resolveArc', () => {
  it('resolveArc without a wake-up is the state arc itself', () => {
    expect(resolveArc('sleep', { durationSec: 3600 })).toBe(STATE_ARCS.sleep);
  });

  it('keeps the base arc before the knee and rises to the target at the end', () => {
    const arc = withWakeUp(STATE_ARCS.sleep, 0.25);
    for (const t of T_GRID.filter((t) => t <= 0.75)) {
      const base = evaluateArc(STATE_ARCS.sleep, t);
      const got = evaluateArc(arc, t);
      expect(got.intensity).toBeCloseTo(base.intensity, 1);
      expect(got.beatOffsetHz).toBeCloseTo(base.beatOffsetHz, 1);
      expect(got.lowpassScale).toBeCloseTo(base.lowpassScale, 1);
    }
    expect(evaluateArc(arc, 1)).toEqual(WAKE_UP_TARGET);
  });

  it('rises monotonically across the rise window', () => {
    const arc = resolveArc('sleep', { wakeUp: { riseSec: 600 }, durationSec: 3600 });
    let prev = evaluateArc(arc, 1 - 600 / 3600);
    for (const t of T_GRID.filter((t) => t > 1 - 600 / 3600)) {
      const cur = evaluateArc(arc, t);
      expect(cur.intensity).toBeGreaterThanOrEqual(prev.intensity - 1e-9);
      expect(cur.beatOffsetHz).toBeGreaterThanOrEqual(prev.beatOffsetHz - 1e-9);
      expect(cur.lowpassScale).toBeGreaterThanOrEqual(prev.lowpassScale - 1e-9);
      prev = cur;
    }
  });

  it('clamps an absurd rise fraction so the knee stays inside the session', () => {
    const arc = withWakeUp(STATE_ARCS.sleep, 5);
    expect(evaluateArc(arc, 0).intensity).toBe(1);
    expect(evaluateArc(arc, 0.05).intensity).toBeLessThanOrEqual(1);
  });
});
