import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type PersonalizationState } from '../storage/types';
import { bestArm, contextualPosterior, pooledPriorMean, updateArm } from './bandit';
import { CANDIDATE_SET_VERSION, PRIOR_ARM_ID } from './candidates';
import { explainServed } from './explain';
import { ARM_CI_Z } from './insights';

function emptyState(): PersonalizationState {
  return { schemaVersion: SCHEMA_VERSION, candidateSetVersion: CANDIDATE_SET_VERSION, arms: {} };
}

/** `n` full-weight rewards of `value` on one focus arm. */
function withRewards(state: PersonalizationState, armId: string, value: number, n: number) {
  let next = state;
  for (let i = 0; i < n; i++) next = updateArm(next, 'focus', armId, { value, weight: 1 });
  return next;
}

describe('explainServed', () => {
  it('counts the cold-start sessions', () => {
    const state = { ...emptyState(), resolved: { focus: 2 } };
    const e = explainServed(
      { state: 'focus', kind: 'served', servedArmId: PRIOR_ARM_ID, servedBy: 'prior' },
      state,
    );
    expect(e?.reason).toBe('Learning your taste — session 3 of 6');
    expect(e?.label).toBe('The default sound');
    expect(e?.scorePct).toBeUndefined();
  });

  it('names the held-out baseline and the locked best', () => {
    const state = emptyState();
    expect(
      explainServed({ state: 'focus', kind: 'served', servedArmId: PRIOR_ARM_ID, servedBy: 'baseline' }, state)
        ?.reason,
    ).toMatch(/default against your favourites/);
    expect(
      explainServed({ state: 'focus', kind: 'served', servedArmId: 'bass-up', servedBy: 'locked' }, state),
    ).toMatchObject({ label: 'More bass', reason: 'Your best so far' });
  });

  it('tells the favourite from an exploratory draw', () => {
    const state = withRewards(withRewards(emptyState(), 'bass-up', 0.95, 4), 'beat-up', 0.2, 3);
    expect(bestArm(state, 'focus')).toBe('bass-up');
    expect(
      explainServed({ state: 'focus', kind: 'served', servedArmId: 'bass-up', servedBy: 'bandit' }, state)
        ?.reason,
    ).toBe('Your current favourite');
    expect(
      explainServed({ state: 'focus', kind: 'served', servedArmId: 'beat-up', servedBy: 'bandit' }, state)
        ?.reason,
    ).toBe('Trying a variation');
  });

  it('scores with the posterior the bandit decided with', () => {
    const state = withRewards(emptyState(), 'bass-up', 0.8, 3);
    const e = explainServed(
      { state: 'focus', kind: 'served', servedArmId: 'bass-up', servedBy: 'bandit' },
      state,
    );
    const p = contextualPosterior(
      state.arms.focus!['bass-up'],
      undefined,
      'bass-up',
      pooledPriorMean(state, 'focus', 'bass-up'),
    );
    expect(e?.scorePct).toBe(Math.round(p.mean * 100));
    expect(e?.ciPct).toBe(Math.round(ARM_CI_Z * p.std * 100));
  });

  it('follows a mid-session switch to the arm now playing', () => {
    const e = explainServed(
      {
        state: 'focus',
        kind: 'served',
        servedArmId: PRIOR_ARM_ID,
        servedBy: 'bandit',
        currentArmId: 'space-on',
      },
      emptyState(),
    );
    expect(e).toMatchObject({ label: 'A sense of space', reason: 'Switched after a check-in' });
  });

  it('explains presets and replays without a score, and stays out of programs', () => {
    const state = emptyState();
    expect(explainServed({ state: 'focus', kind: 'preset' }, state)?.note).toBeDefined();
    expect(explainServed({ state: 'focus', kind: 'replay' }, state)?.scorePct).toBeUndefined();
    expect(explainServed({ state: 'focus', kind: 'program' }, state)).toBeNull();
  });
});
