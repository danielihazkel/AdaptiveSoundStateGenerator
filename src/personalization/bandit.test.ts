import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { SCHEMA_VERSION, type PersonalizationState, type SessionRecord } from '../storage/types';
import { CANDIDATE_SET_VERSION, candidatesFor, PRIOR_ARM_ID } from './candidates';
import {
  bestArm,
  COLD_START_SESSIONS,
  DECAY,
  DECAY_HALF_LIFE_SESSIONS,
  decayState,
  eligibleSessionCount,
  posteriorFor,
  PRIOR_ARM_MEAN,
  rebuildFromSessions,
  sampleArm,
  updateArm,
} from './bandit';
import { computeReward } from './reward';
import { contextualPosterior, CONTEXT_SHRINK_N, MIN_POSTERIOR_STD } from './bandit';
import { contextOf, timeBucketOf, type ServeContext } from './context';

/** Deterministic LCG (numerical recipes constants) for seeded Thompson draws. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296; // (0, 1) — never exactly 0
  };
}

function emptyState(): PersonalizationState {
  return { schemaVersion: SCHEMA_VERSION, candidateSetVersion: CANDIDATE_SET_VERSION, arms: {} };
}

describe('posteriorFor', () => {
  it('starts at the prior mean with full prior std', () => {
    expect(posteriorFor(undefined, PRIOR_ARM_ID).mean).toBe(PRIOR_ARM_MEAN);
    expect(posteriorFor(undefined, 'beat-down').mean).toBe(0.5);
    expect(posteriorFor(undefined, 'beat-down').std).toBe(0.25);
  });

  it('converges toward the empirical mean as pulls accumulate', () => {
    // 20 weighted pulls of value 0.9: mean → (0.5·1 + 18)/21 ≈ 0.881
    const stats = { n: 20, sum: 18, sumSq: 16.2 };
    const { mean, std } = posteriorFor(stats, 'beat-down');
    expect(mean).toBeCloseTo(18.5 / 21, 5);
    expect(std).toBeLessThan(0.06);
  });

  it('Phase 10: noisy arms keep a wider posterior than consistent ones, never below the floor', () => {
    // Same mean (0.6 over 10 pulls), different spread.
    const consistent = { n: 10, sum: 6, sumSq: 3.6 }; // every pull exactly 0.6
    const noisy = { n: 10, sum: 6, sumSq: 5.2 }; // pulls swing 0.2..1.0
    const tight = posteriorFor(consistent, 'beat-down');
    const wide = posteriorFor(noisy, 'beat-down');
    expect(tight.mean).toBe(wide.mean);
    expect(wide.std).toBeGreaterThan(tight.std);
    expect(tight.std).toBeGreaterThanOrEqual(MIN_POSTERIOR_STD);
    // Untouched arms are bit-identical to the pre-variance behaviour.
    expect(posteriorFor(undefined, 'beat-down').std).toBe(0.25);
    expect(posteriorFor({ n: 0, sum: 0, sumSq: 0 }, 'beat-down').std).toBe(0.25);
  });
});

describe('updateArm', () => {
  it('applies weighted updates immutably', () => {
    const before = emptyState();
    const after = updateArm(before, 'focus', 'beat-down', { value: 0.8, weight: 0.5 });
    expect(before.arms).toEqual({});
    const stats = after.arms.focus!['beat-down'];
    expect(stats.n).toBeCloseTo(0.5, 10);
    expect(stats.sum).toBeCloseTo(0.4, 10);
    expect(stats.sumSq).toBeCloseTo(0.32, 10);

    const twice = updateArm(after, 'focus', 'beat-down', { value: 0.8, weight: 0.5 });
    expect(twice.arms.focus!['beat-down'].n).toBeCloseTo(1, 10);
  });

  it('eligibleSessionCount sums weighted pulls per state', () => {
    let state = emptyState();
    state = updateArm(state, 'focus', PRIOR_ARM_ID, { value: 0.6, weight: 1 });
    state = updateArm(state, 'focus', 'noise-up', { value: 0.5, weight: 0.6 });
    state = updateArm(state, 'sleep', PRIOR_ARM_ID, { value: 0.7, weight: 1 });
    expect(eligibleSessionCount(state, 'focus')).toBeCloseTo(1.6, 10);
    expect(eligibleSessionCount(state, 'sleep')).toBe(1);
    expect(eligibleSessionCount(state, 'energy')).toBe(0);
    expect(eligibleSessionCount(state, 'focus')).toBeLessThan(COLD_START_SESSIONS);
  });
});

describe('decayState', () => {
  it('shrinks every arm of the state by DECAY and counts the session, immutably', () => {
    let state = emptyState();
    state = updateArm(state, 'focus', PRIOR_ARM_ID, { value: 0.6, weight: 1 });
    state = updateArm(state, 'focus', 'noise-up', { value: 0.5, weight: 0.6 });
    state = updateArm(state, 'sleep', PRIOR_ARM_ID, { value: 0.7, weight: 1 });
    const before = JSON.stringify(state);
    const after = decayState(state, 'focus');
    expect(JSON.stringify(state)).toBe(before);
    expect(after.arms.focus![PRIOR_ARM_ID].n).toBeCloseTo(DECAY, 12);
    expect(after.arms.focus![PRIOR_ARM_ID].sum).toBeCloseTo(0.6 * DECAY, 12);
    expect(after.arms.focus!['noise-up'].sumSq).toBeCloseTo(0.6 * 0.25 * DECAY, 12);
    expect(after.arms.sleep).toEqual(state.arms.sleep);
    expect(after.resolved).toEqual({ focus: 1 });
    expect(decayState(after, 'focus').resolved).toEqual({ focus: 2 });
  });

  it('has the documented half-life', () => {
    expect(DECAY ** DECAY_HALF_LIFE_SESSIONS).toBeCloseTo(0.5, 12);
    expect(DECAY).toBeLessThan(1);
    expect(DECAY).toBeGreaterThan(0.98);
  });

  it('eligibleSessionCount prefers the undecayed counter over Σn', () => {
    let state = emptyState();
    for (let i = 0; i < 10; i++) {
      state = decayState(state, 'focus');
      state = updateArm(state, 'focus', PRIOR_ARM_ID, { value: 0.5, weight: 0.6 });
    }
    expect(eligibleSessionCount(state, 'focus')).toBe(10);
    expect(state.arms.focus![PRIOR_ARM_ID].n).toBeLessThan(6);
    expect(eligibleSessionCount(state, 'sleep')).toBe(0);
  });
});

describe('bestArm', () => {
  it('is the deterministic argmax of posterior means, prior on ties', () => {
    expect(bestArm(emptyState(), 'focus')).toBe(PRIOR_ARM_ID);

    let state = emptyState();
    for (let i = 0; i < 5; i++) {
      state = updateArm(state, 'focus', 'noise-alt', { value: 0.95, weight: 1 });
      state = updateArm(state, 'focus', PRIOR_ARM_ID, { value: 0.4, weight: 1 });
    }
    expect(bestArm(state, 'focus')).toBe('noise-alt');
  });
});

describe('sampleArm (Thompson)', () => {
  it('overwhelmingly picks a clearly better arm once every arm has data', () => {
    let state = emptyState();
    // Every arm tried a few times and found mediocre — except one great arm.
    // (Arms with NO data still attract exploration draws by design.)
    for (const { id } of candidatesFor('focus')) {
      for (let i = 0; i < 4; i++) {
        const value = id === 'beat-down' ? 0.9 : 0.45;
        state = updateArm(state, 'focus', id, { value, weight: 1 });
      }
    }
    const rng = lcg(42);
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      if (sampleArm(state, 'focus', rng) === 'beat-down') hits++;
    }
    expect(hits / 200).toBeGreaterThan(0.7);
  });

  it('explores: with no data, different arms get sampled', () => {
    const rng = lcg(7);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(sampleArm(emptyState(), 'focus', rng));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('is deterministic for a fixed seed', () => {
    const picks = () => {
      const rng = lcg(123);
      return Array.from({ length: 10 }, () => sampleArm(emptyState(), 'relax', rng));
    };
    expect(picks()).toEqual(picks());
  });
});

describe('rebuildFromSessions', () => {
  function record(overrides: Partial<SessionRecord>): SessionRecord {
    return {
      id: Math.random().toString(36).slice(2),
      startedAt: '2026-08-20T22:00:00.000Z',
      state: 'focus',
      intensity: 0.5,
      plannedDurationSec: 1800,
      actualDurationSec: 1800,
      completed: true,
      customized: false,
      volumeAdjustments: 0,
      monoMode: false,
      profile: STATES.focus.buildProfile(0.5),
      servedArmId: PRIOR_ARM_ID,
      servedBy: 'bandit',
      banditResolvedAt: '2026-08-21T08:00:00.000Z',
      ...overrides,
    };
  }

  it('equals the incremental updates (decay, then credit) for the same resolved records', () => {
    // Stored newest-first, resolved in the opposite order.
    const records = [
      record({ servedArmId: 'beat-down', completed: false, actualDurationSec: 400, banditResolvedAt: '2026-08-23T08:00:00.000Z' }),
      record({ servedArmId: 'noise-up', banditResolvedAt: '2026-08-22T08:00:00.000Z' }),
      record({ feedback: { rating: 5, ratedAt: '2026-08-21T08:00:00.000Z' }, banditResolvedAt: '2026-08-21T08:00:00.000Z' }),
    ];
    let incremental = emptyState();
    for (const r of [...records].reverse()) {
      incremental = decayState(incremental, r.state);
      incremental = updateArm(
        incremental,
        r.state,
        r.servedArmId!,
        computeReward(r)!,
        contextOf(r.startedAt, r.monoMode) ?? undefined,
      );
    }
    expect(rebuildFromSessions(records)).toEqual(incremental);
    expect(incremental.resolved).toEqual({ focus: 3 });
  });

  it('replays equal stamps oldest-first (higher stored index) so order is deterministic', () => {
    const records = [
      record({ servedArmId: 'noise-up' }),
      record({ feedback: { rating: 5, ratedAt: '2026-08-21T08:00:00.000Z' } }),
    ];
    let incremental = emptyState();
    for (const r of [records[1], records[0]]) {
      incremental = decayState(incremental, r.state);
      incremental = updateArm(
        incremental,
        r.state,
        r.servedArmId!,
        computeReward(r)!,
        contextOf(r.startedAt, r.monoMode) ?? undefined,
      );
    }
    expect(rebuildFromSessions(records)).toEqual(incremental);
  });

  it('credits a replayed session to the arm behind its source', () => {
    const source = record({ id: 'src', servedArmId: 'iso-off', banditResolvedAt: '2026-08-21T08:00:00.000Z' });
    const replay = record({
      id: 'rep',
      servedArmId: undefined,
      servedBy: undefined,
      replayOfSessionId: 'src',
      banditResolvedAt: '2026-08-22T08:00:00.000Z',
    });
    const rebuilt = rebuildFromSessions([replay, source]);
    expect(rebuilt.arms.focus!['iso-off'].n).toBeGreaterThan(computeReward(source)!.weight);
    expect(rebuilt.resolved).toEqual({ focus: 2 });
    // Without the source the replay has nothing to credit.
    expect(rebuildFromSessions([replay]).arms).toEqual({});
  });

  it('ignores unresolved, preset, and pre-Phase-2 records', () => {
    const rebuilt = rebuildFromSessions([
      record({ banditResolvedAt: undefined }),
      record({ servedBy: 'preset', presetId: 'p1' }),
      record({ servedArmId: undefined, servedBy: undefined }),
    ]);
    expect(rebuilt.arms).toEqual({});
  });

  it('is idempotent: rebuilding twice from the same records matches', () => {
    const records = [record({}), record({ servedArmId: 'iso-off' })];
    expect(rebuildFromSessions(records)).toEqual(rebuildFromSessions(records));
  });
});

describe('contextual posterior', () => {
  const morning: ServeContext = { bucket: 'morning', mono: false };
  const night: ServeContext = { bucket: 'night', mono: false };

  function ctxRecord(overrides: Partial<SessionRecord>): SessionRecord {
    return {
      id: Math.random().toString(36).slice(2),
      startedAt: '2026-08-20T22:00:00.000Z',
      state: 'focus',
      intensity: 0.5,
      plannedDurationSec: 1800,
      actualDurationSec: 1800,
      completed: true,
      customized: false,
      volumeAdjustments: 0,
      monoMode: false,
      profile: STATES.focus.buildProfile(0.5),
      servedArmId: PRIOR_ARM_ID,
      servedBy: 'bandit',
      banditResolvedAt: '2026-08-21T08:00:00.000Z',
      ...overrides,
    };
  }

  it('fixed-seed regression: draws are unchanged for context-free calls and empty contexts', () => {
    let state = emptyState();
    state = updateArm(state, 'relax', PRIOR_ARM_ID, { value: 0.6, weight: 1 });
    state = updateArm(state, 'relax', 'noise-up', { value: 0.9, weight: 0.6 });
    // Captured with this exact seed/state; re-pinned when the v4 arm menu
    // grew (a larger menu consumes the rng differently — expected). The
    // invariant under test is that an empty context never changes a draw.
    const pinned = [
      'space-on', 'bass-up', 'beat-down', 'warmth-up', 'binaural-soft', 'pulse-deep',
      'beat-up', 'noise-alt', 'beat-up', 'binaural-soft', 'binaural-soft', 'beat-up',
    ];
    const rng1 = lcg(123);
    expect(Array.from({ length: 12 }, () => sampleArm(state, 'relax', rng1))).toEqual(pinned);
    const rng2 = lcg(123);
    expect(Array.from({ length: 12 }, () => sampleArm(state, 'relax', rng2, morning))).toEqual(pinned);
  });

  it('equals posteriorFor with no context evidence, then shrinks toward the context mean', () => {
    const stateStats = { n: 4, sum: 2.4, sumSq: 1.5 };
    expect(contextualPosterior(stateStats, undefined, 'noise-up')).toEqual(posteriorFor(stateStats, 'noise-up'));
    expect(contextualPosterior(stateStats, { n: 0, sum: 0, sumSq: 0 }, 'noise-up')).toEqual(posteriorFor(stateStats, 'noise-up'));
    const base = posteriorFor(stateStats, 'noise-up').mean;
    const little = contextualPosterior(stateStats, { n: 1, sum: 0.95, sumSq: 0.9 }, 'noise-up');
    expect(little.mean).toBeGreaterThan(base);
    expect(little.mean).toBeCloseTo((base * CONTEXT_SHRINK_N + 0.95) / (CONTEXT_SHRINK_N + 1), 12);
    const lots = contextualPosterior(stateStats, { n: 300, sum: 285, sumSq: 270 }, 'noise-up');
    expect(lots.mean).toBeCloseTo(0.95, 1);
    // Phase 10: context evidence narrows the spread (down to the floor).
    expect(lots.std).toBeLessThan(posteriorFor(stateStats, 'noise-up').std);
    expect(lots.std).toBeGreaterThanOrEqual(MIN_POSTERIOR_STD);
  });

  it('updateArm writes the state level always and the context when given', () => {
    let state = emptyState();
    state = updateArm(state, 'focus', 'noise-up', { value: 0.8, weight: 1 });
    expect(state.contexts).toBeUndefined();
    state = updateArm(state, 'focus', 'noise-up', { value: 0.9, weight: 1 }, morning);
    expect(state.arms.focus!['noise-up'].n).toBe(2);
    expect(state.contexts!.focus!['morning:stereo']['noise-up']).toEqual({ n: 1, sum: 0.9, sumSq: 0.81 });
    state = updateArm(state, 'focus', 'noise-up', { value: 0.2, weight: 1 }, { ...morning, mono: true });
    expect(Object.keys(state.contexts!.focus!).sort()).toEqual(['morning:mono', 'morning:stereo']);
  });

  it('bestArm and sampleArm follow the context once it has evidence', () => {
    let state = emptyState();
    // Every arm has been tried and found mediocre (untried arms explore at full prior std).
    for (const { id } of candidatesFor('focus')) {
      for (let i = 0; i < 4; i++) state = updateArm(state, 'focus', id, { value: 0.45, weight: 1 });
    }
    for (let i = 0; i < 6; i++) {
      state = updateArm(state, 'focus', 'noise-up', { value: 0.9, weight: 1 }, morning);
      state = updateArm(state, 'focus', 'beat-down', { value: 0.9, weight: 1 }, night);
      state = updateArm(state, 'focus', 'noise-up', { value: 0.3, weight: 1 }, night);
      state = updateArm(state, 'focus', 'beat-down', { value: 0.3, weight: 1 }, morning);
    }
    expect(bestArm(state, 'focus', morning)).toBe('noise-up');
    expect(bestArm(state, 'focus', night)).toBe('beat-down');
    const rng = lcg(9);
    let morningHits = 0;
    for (let i = 0; i < 100; i++) {
      if (sampleArm(state, 'focus', rng, morning) === 'noise-up') morningHits++;
    }
    expect(morningHits).toBeGreaterThan(60);
  });

  it('decay reaches contexts and rebuild with contexts equals incremental', () => {
    let state = emptyState();
    state = updateArm(state, 'focus', 'noise-up', { value: 0.9, weight: 1 }, morning);
    const decayed = decayState(state, 'focus');
    expect(decayed.contexts!.focus!['morning:stereo']['noise-up'].n).toBeCloseTo(DECAY, 12);

    const records = [
      ctxRecord({ servedArmId: 'noise-up', startedAt: '2026-08-22T20:00:00.000Z', monoMode: true, banditResolvedAt: '2026-08-23T08:00:00.000Z' }),
      ctxRecord({ servedArmId: 'beat-down', startedAt: '2026-08-21T20:00:00.000Z', banditResolvedAt: '2026-08-22T08:00:00.000Z' }),
    ];
    let incremental = emptyState();
    for (const r of [...records].reverse()) {
      incremental = decayState(incremental, r.state);
      const ctx = { bucket: timeBucketOf(new Date(r.startedAt)), mono: r.monoMode };
      incremental = updateArm(incremental, r.state, r.servedArmId!, computeReward(r)!, ctx);
    }
    const rebuilt = rebuildFromSessions(records);
    expect(rebuilt).toEqual(incremental);
    expect(Object.keys(rebuilt.contexts!.focus!).length).toBe(2);
    expect(Object.keys(rebuilt.contexts!.focus!).some((k) => k.endsWith(':mono'))).toBe(true);
  });
});
