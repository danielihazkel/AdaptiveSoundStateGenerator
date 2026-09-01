import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { Rating, SessionRecord } from '../storage/types';
import {
  CHECKPOINT_VALUES,
  CHECKPOINT_WEIGHT,
  computeCredits,
  computeReward,
  CUSTOMIZED_VALUE_CAP,
  CUSTOMIZED_WEIGHT,
  END_CREDIT_MIN_SCALE,
  IMPLICIT_ONLY_WEIGHT,
  INTERVAL_SESSION_WEIGHT,
  OPEN_ENDED_TARGET_SEC,
  scoreSession,
  VOLUME_PENALTY_FLOOR,
} from './reward';

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    startedAt: '2026-08-23T08:00:00.000Z',
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
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
  return makeRecord({
    feedback: { rating, ratedAt: '2026-08-23T09:00:00.000Z' },
    ...overrides,
  });
}

describe('computeReward', () => {
  it('returns null for preset sessions and pre-Phase-2 records', () => {
    expect(computeReward(makeRecord({ servedBy: 'preset' }))).toBeNull();
    expect(
      computeReward(makeRecord({ servedArmId: undefined, servedBy: undefined })),
    ).toBeNull();
  });

  it('maps rating endpoints: 5/completed near 1, 1/completed low', () => {
    // 0.7·1 + 0.3·0.65 = 0.895
    expect(computeReward(rated(5))!.value).toBeCloseTo(0.895, 5);
    // 0.7·0 + 0.3·0.65 = 0.195
    expect(computeReward(rated(1))!.value).toBeCloseTo(0.195, 5);
    expect(computeReward(rated(5))!.weight).toBe(1);
  });

  it('unrated sessions use the implicit score with reduced weight', () => {
    const completed = computeReward(makeRecord())!;
    expect(completed.value).toBeCloseTo(0.65, 5); // 0.15 + 0.5·1
    expect(completed.weight).toBe(IMPLICIT_ONLY_WEIGHT);

    const early = computeReward(
      makeRecord({ actualDurationSec: 600, completed: false }),
    )!;
    expect(early.value).toBeCloseTo(0.15 + 0.5 * (600 / 1800), 5);
  });

  it('an unrated completed session never outranks a rated 4', () => {
    const unrated = computeReward(makeRecord())!.value;
    const ratedFour = computeReward(rated(4))!.value;
    expect(unrated).toBeLessThan(ratedFour);
  });

  it('preserves quality ordering across signal types', () => {
    // Designed ordering: an unrated completed session (0.65, weight 0.6) sits
    // between a rated 3 and a rated 4 — completion is weak positive evidence,
    // discounted by weight rather than value.
    const values = [
      rated(5),
      rated(4),
      makeRecord(), // unrated, completed
      rated(3),
      makeRecord({ actualDurationSec: 300, completed: false }), // unrated, early stop
      rated(1),
    ].map((r) => computeReward(r)!.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('penalizes repeated volume tweaks with a floor, first tweak free', () => {
    const base = computeReward(makeRecord())!.value;
    expect(computeReward(makeRecord({ volumeAdjustments: 1 }))!.value).toBe(base);
    expect(computeReward(makeRecord({ volumeAdjustments: 3 }))!.value).toBeCloseTo(
      base - 0.1,
      5,
    );
    // 10 tweaks would be −0.45 unfloored.
    expect(computeReward(makeRecord({ volumeAdjustments: 10 }))!.value).toBeCloseTo(
      base + VOLUME_PENALTY_FLOOR,
      5,
    );
  });

  it('caps value and weight for customized sessions', () => {
    const result = computeReward(rated(5, { customized: true }))!;
    expect(result.value).toBe(CUSTOMIZED_VALUE_CAP);
    expect(result.weight).toBe(CUSTOMIZED_WEIGHT);
  });

  it('clamps the final value into [0, 1]', () => {
    const worst = computeReward(
      rated(1, { actualDurationSec: 0, completed: false, volumeAdjustments: 20 }),
    )!;
    expect(worst.value).toBeGreaterThanOrEqual(0);
    expect(worst.value).toBeLessThanOrEqual(1);
  });

  it('treats zero planned duration as zero completion instead of dividing by zero', () => {
    const result = computeReward(makeRecord({ plannedDurationSec: 0 }))!;
    expect(result.value).toBeCloseTo(0.15, 5);
  });
});

describe('computeCredits (Phase 3 segments)', () => {
  it('is bit-identical to computeReward for segment-less records', () => {
    for (const record of [makeRecord(), rated(4), rated(1, { customized: true })]) {
      expect(computeCredits(record)).toEqual([
        { armId: record.servedArmId, reward: computeReward(record) },
      ]);
    }
  });

  it('returns nothing for presets and pre-Phase-2 records', () => {
    expect(computeCredits(makeRecord({ servedBy: 'preset' }))).toEqual([]);
    expect(
      computeCredits(makeRecord({ servedArmId: undefined, servedBy: undefined })),
    ).toEqual([]);
  });

  it('credits each answered segment at the checkpoint weight', () => {
    const record = makeRecord({
      actualDurationSec: 1800,
      segments: [
        { armId: 'prior', startSec: 0, endSec: 600, response: 'same', volumeAdjustments: 0 },
        { armId: 'beat-up', startSec: 600, endSec: 1200, response: 'worse', volumeAdjustments: 0 },
        { armId: 'noise-alt', startSec: 1200, endSec: 1800, volumeAdjustments: 0 },
      ],
    });
    const credits = computeCredits(record);
    expect(credits).toHaveLength(3); // two checkpoint credits + end credit
    expect(credits[0]).toEqual({
      armId: 'prior',
      reward: { value: CHECKPOINT_VALUES.same, weight: CHECKPOINT_WEIGHT },
    });
    expect(credits[1]).toEqual({
      armId: 'beat-up',
      reward: { value: CHECKPOINT_VALUES.worse, weight: CHECKPOINT_WEIGHT },
    });
  });

  it('sends the end-of-session reward to the last arm, weight-scaled by its share', () => {
    const record = rated(5, {
      actualDurationSec: 1800,
      segments: [
        { armId: 'prior', startSec: 0, endSec: 600, response: 'worse', volumeAdjustments: 0 },
        { armId: 'beat-down', startSec: 600, endSec: 1800, volumeAdjustments: 0 },
      ],
    });
    const credits = computeCredits(record);
    const end = credits[credits.length - 1];
    const session = scoreSession(record);
    expect(end.armId).toBe('beat-down');
    expect(end.reward.value).toBe(session.value);
    expect(end.reward.weight).toBeCloseTo(session.weight * (1200 / 1800), 5);
  });

  it('floors the end-credit scale for a short last segment', () => {
    const record = makeRecord({
      actualDurationSec: 3600,
      segments: [
        { armId: 'prior', startSec: 0, endSec: 3000, response: 'worse', volumeAdjustments: 0 },
        { armId: 'beat-up', startSec: 3000, endSec: 3600, volumeAdjustments: 0 },
      ],
    });
    const end = computeCredits(record).at(-1)!;
    const session = scoreSession(record);
    expect(end.reward.weight).toBeCloseTo(session.weight * END_CREDIT_MIN_SCALE, 5);
  });

  it('applies the per-segment volume penalty, first tweak free', () => {
    const base = computeCredits(
      makeRecord({
        segments: [
          { armId: 'prior', startSec: 0, endSec: 600, response: 'same', volumeAdjustments: 1 },
          { armId: 'prior', startSec: 600, endSec: 1800, volumeAdjustments: 0 },
        ],
      }),
    )[0].reward.value;
    expect(base).toBe(CHECKPOINT_VALUES.same);

    const penalized = computeCredits(
      makeRecord({
        segments: [
          { armId: 'prior', startSec: 0, endSec: 600, response: 'same', volumeAdjustments: 3 },
          { armId: 'prior', startSec: 600, endSec: 1800, volumeAdjustments: 0 },
        ],
      }),
    )[0].reward.value;
    expect(penalized).toBeCloseTo(CHECKPOINT_VALUES.same - 0.1, 5);
  });

  describe('open-ended sessions', () => {
    it('counts staying the target length as a full completion', () => {
      const open = scoreSession(
        makeRecord({
          openEnded: true,
          plannedDurationSec: OPEN_ENDED_TARGET_SEC,
          actualDurationSec: OPEN_ENDED_TARGET_SEC,
        }),
      );
      const fixed = scoreSession(makeRecord({ plannedDurationSec: 1800, actualDurationSec: 1800 }));
      expect(open).toEqual(fixed);
      const longer = scoreSession(
        makeRecord({ openEnded: true, plannedDurationSec: 7200, actualDurationSec: 7200 }),
      );
      expect(longer).toEqual(fixed);
    });

    it('scales a short voluntary stay like an early stop', () => {
      const brief = scoreSession(
        makeRecord({
          openEnded: true,
          plannedDurationSec: OPEN_ENDED_TARGET_SEC / 5,
          actualDurationSec: OPEN_ENDED_TARGET_SEC / 5,
        }),
      );
      const early = scoreSession(makeRecord({ plannedDurationSec: 1800, actualDurationSec: 360 }));
      expect(brief.value).toBeCloseTo(early.value, 6);
      expect(brief.weight).toBe(early.weight);
    });
  });

  describe('interval sessions', () => {
    const plan = { workMin: 25, breakMin: 5, cycles: 4, boundaryChime: true };

    it('credit the served arm at reduced weight', () => {
      const plain = computeCredits(rated(5));
      const interval = computeCredits(rated(5, { intervals: plan }));
      expect(interval).toHaveLength(1);
      expect(interval[0].armId).toBe(plain[0].armId);
      expect(interval[0].reward.value).toBe(plain[0].reward.value);
      expect(interval[0].reward.weight).toBeCloseTo(plain[0].reward.weight * INTERVAL_SESSION_WEIGHT, 6);
    });

    it('scale every segment credit, and still give nothing to preset or recovered sessions', () => {
      const segmented = computeCredits(
        rated(4, {
          intervals: plan,
          segments: [
            { armId: 'prior', startSec: 0, endSec: 600, response: 'better', volumeAdjustments: 0 },
            { armId: 'beat-up', startSec: 600, endSec: 1800, volumeAdjustments: 0 },
          ],
        }),
      );
      expect(segmented).toHaveLength(2);
      expect(segmented[0].reward.weight).toBeCloseTo(CHECKPOINT_WEIGHT * INTERVAL_SESSION_WEIGHT, 6);
      expect(computeCredits(makeRecord({ intervals: plan, servedBy: 'preset' }))).toEqual([]);
      expect(computeCredits(makeRecord({ intervals: plan, recovered: true }))).toEqual([]);
    });
  });
});
