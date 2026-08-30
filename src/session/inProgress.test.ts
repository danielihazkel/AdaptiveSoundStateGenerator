import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { computeCredits } from '../personalization/reward';
import type { InProgressSession } from '../storage/types';
import { MIN_RECOVERABLE_SEC, recoverSession } from './inProgress';

function checkpoint(overrides: Partial<InProgressSession> = {}): InProgressSession {
  return {
    startedAt: '2026-08-30T01:00:00.000Z',
    state: 'sleep',
    intensity: 0.6,
    plannedDurationSec: 3600,
    profile: STATES.sleep.buildProfile(0.6),
    monoMode: false,
    servedArmId: 'prior',
    servedBy: 'bandit',
    elapsedSec: 1500,
    updatedAt: '2026-08-30T01:25:00.000Z',
    ...overrides,
  };
}

describe('recoverSession', () => {
  it('builds an incomplete, recovered record from a checkpoint', () => {
    const record = recoverSession(checkpoint())!;
    expect(record.completed).toBe(false);
    expect(record.recovered).toBe(true);
    expect(record.feedbackSkipped).toBe(true);
    expect(record.actualDurationSec).toBe(1500);
    expect(record.state).toBe('sleep');
    expect(record.servedArmId).toBe('prior');
  });

  it('drops checkpoints shorter than the minimum', () => {
    expect(recoverSession(checkpoint({ elapsedSec: MIN_RECOVERABLE_SEC - 1 }))).toBeNull();
    expect(recoverSession(checkpoint({ elapsedSec: MIN_RECOVERABLE_SEC }))).not.toBeNull();
  });

  it('never exceeds the planned duration', () => {
    expect(recoverSession(checkpoint({ elapsedSec: 5000 }))!.actualDurationSec).toBe(3600);
  });

  it('a recovered session carries no bandit credit', () => {
    expect(computeCredits(recoverSession(checkpoint())!)).toEqual([]);
  });
});
