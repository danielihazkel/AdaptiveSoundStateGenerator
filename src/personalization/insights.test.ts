import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { NoiseType } from '../audio/types';
import {
  SCHEMA_VERSION,
  type PersonalizationState,
  type Rating,
  type SessionRecord,
} from '../storage/types';
import { CANDIDATE_SET_VERSION } from './candidates';
import { computeInsights, MIN_SESSIONS_FOR_INSIGHTS } from './insights';

function emptyBandit(): PersonalizationState {
  return { schemaVersion: SCHEMA_VERSION, candidateSetVersion: CANDIDATE_SET_VERSION, arms: {} };
}

function focusSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    startedAt: '2026-08-20T10:00:00.000Z',
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 2700,
    actualDurationSec: 2700,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
    servedArmId: 'prior',
    servedBy: 'bandit',
    ...overrides,
  };
}

function rated(rating: Rating, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return focusSession({
    feedback: { rating, ratedAt: '2026-08-20T11:00:00.000Z' },
    ...overrides,
  });
}

describe('computeInsights', () => {
  it('tolerates legacy records whose profiles predate newer fields', () => {
    // Stored sessions from before ambience/warmth existed come back without
    // those fields — insights must normalize, not crash.
    const legacy = Array.from({ length: MIN_SESSIONS_FOR_INSIGHTS }, () => {
      const record = focusSession();
      const profile = record.profile as unknown as Record<string, unknown>;
      delete profile.ambience;
      delete (profile.tone as Record<string, unknown>).warmth;
      return record;
    });
    const [insight] = computeInsights(legacy, emptyBandit());
    expect(insight.sessionCount).toBe(MIN_SESSIONS_FOR_INSIGHTS);
    const ambience = insight.componentEffectiveness.find(
      (c) => c.component === 'ambience',
    );
    // defaultProfile has ambience disabled, so legacy records count as "off".
    expect(ambience?.sessionsOn).toBe(0);
  });

  it('gates on the per-state minimum session count', () => {
    const few = Array.from({ length: MIN_SESSIONS_FOR_INSIGHTS - 1 }, () =>
      focusSession(),
    );
    expect(computeInsights(few, emptyBandit())).toEqual([]);

    const enough = [...few, focusSession()];
    const insights = computeInsights(enough, emptyBandit());
    expect(insights).toHaveLength(1);
    expect(insights[0].state).toBe('focus');
    expect(insights[0].sessionCount).toBe(MIN_SESSIONS_FOR_INSIGHTS);
  });

  it('computes rating stats and includes preset sessions', () => {
    const sessions = [
      rated(5),
      rated(3),
      focusSession({ servedArmId: undefined, servedBy: 'preset', presetId: 'p1' }),
      focusSession(),
      focusSession(),
    ];
    const [insight] = computeInsights(sessions, emptyBandit());
    expect(insight.ratedCount).toBe(2);
    expect(insight.avgRating).toBe(4);
    expect(insight.sessionCount).toBe(5);
  });

  it('reports the best arm only once it has enough pulls', () => {
    const sessions = Array.from({ length: 5 }, () => focusSession());
    const thin = emptyBandit();
    thin.arms.focus = { 'beat-down': { n: 2, sum: 1.8, sumSq: 1.62 } };
    expect(computeInsights(sessions, thin)[0].bestArm).toBeNull();

    const ripe = emptyBandit();
    ripe.arms.focus = {
      'beat-down': { n: 4, sum: 3.6, sumSq: 3.24 }, // mean ≈ 0.9
      prior: { n: 4, sum: 1.6, sumSq: 0.64 }, // mean ≈ 0.4
    };
    const best = computeInsights(sessions, ripe)[0].bestArm;
    expect(best?.id).toBe('beat-down');
    expect(best?.label).toBe('Slower beat');
  });

  it('prefers the noise type with the best scores, needing 3+ sessions per type', () => {
    const withNoise = (type: NoiseType, rating: Rating) => {
      const profile = STATES.focus.buildProfile(0.5);
      profile.noise.type = type;
      return rated(rating, { profile });
    };
    const sessions = [
      withNoise('brown', 5),
      withNoise('brown', 5),
      withNoise('brown', 4),
      withNoise('pink', 2),
      withNoise('pink', 2),
      withNoise('pink', 1),
      withNoise('white', 5), // only 1 session — ineligible despite the 5
    ];
    expect(computeInsights(sessions, emptyBandit())[0].preferredNoiseType).toBe('brown');
  });

  it('derives beat range, volume, and duration medians', () => {
    const atBeat = (beat: number, rating: Rating) => {
      const profile = STATES.focus.buildProfile(0.5);
      profile.binaural.beat = beat;
      return rated(rating, { profile });
    };
    const sessions = [
      atBeat(10, 4),
      atBeat(12, 5),
      atBeat(14, 5),
      atBeat(16, 4),
      atBeat(18, 1),
    ];
    const [insight] = computeInsights(sessions, emptyBandit());
    const [low, high] = insight.preferredBeatRange!;
    expect(low).toBeGreaterThanOrEqual(10);
    expect(high).toBeLessThanOrEqual(18);
    expect(low).toBeLessThanOrEqual(high);
    // The poorly-rated 18 Hz session shouldn't drag the range upward.
    expect(high).toBeLessThan(18);

    expect(insight.preferredVolume).toBe(0.5);
    expect(insight.typicalDurationMin).toBe(45);
  });

  it('componentEffectiveness reflects enabled layers', () => {
    const sessions = Array.from({ length: 5 }, () => rated(4));
    const [insight] = computeInsights(sessions, emptyBandit());
    const byComponent = Object.fromEntries(
      insight.componentEffectiveness.map((c) => [c.component, c]),
    );
    // Focus profiles: binaural + noise + isochronic on, tone off.
    expect(byComponent.binaural.sessionsOn).toBe(5);
    expect(byComponent.tone.sessionsOn).toBe(0);
    expect(byComponent.noise.avgRewardWhenOn).toBeGreaterThan(0.5);
  });
});
