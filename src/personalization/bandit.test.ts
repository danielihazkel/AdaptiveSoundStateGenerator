import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { SCHEMA_VERSION, type PersonalizationState, type SessionRecord } from '../storage/types';
import { CANDIDATE_SET_VERSION, candidatesFor, PRIOR_ARM_ID } from './candidates';
import {
  bestArm,
  COLD_START_SESSIONS,
  eligibleSessionCount,
  posteriorFor,
  PRIOR_ARM_MEAN,
  rebuildFromSessions,
  sampleArm,
  updateArm,
} from './bandit';
import { computeReward } from './reward';

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

  it('equals the incremental updates for the same resolved records', () => {
    const records = [
      record({ feedback: { rating: 5, ratedAt: '2026-08-21T08:00:00.000Z' } }),
      record({ servedArmId: 'noise-up' }),
      record({ servedArmId: 'beat-down', completed: false, actualDurationSec: 400 }),
    ];
    let incremental = emptyState();
    for (const r of records) {
      incremental = updateArm(incremental, r.state, r.servedArmId!, computeReward(r)!);
    }
    expect(rebuildFromSessions(records)).toEqual(incremental);
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
