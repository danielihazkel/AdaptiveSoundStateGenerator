import { describe, expect, it } from 'vitest';
import { coachPlan, ENERGY_MISMATCH_INTENSITY_BUMP } from './mapToSession';
import type { CoachRequest } from './types';

function request(overrides: Partial<CoachRequest> = {}): CoachRequest {
  return {
    goal: 'study',
    energy: null,
    durationMin: null,
    desiredArousal: null,
    distractionMasking: null,
    ...overrides,
  };
}

describe('coachPlan', () => {
  it('returns null without a goal', () => {
    expect(coachPlan(request({ goal: null }))).toBeNull();
  });

  it('maps goals onto states with their default durations', () => {
    expect(coachPlan(request({ goal: 'study' }))).toMatchObject({
      state: 'focus',
      minutes: 60,
    });
    expect(coachPlan(request({ goal: 'work' }))!.state).toBe('focus');
    expect(coachPlan(request({ goal: 'relax' }))).toMatchObject({
      state: 'relax',
      minutes: 30,
    });
    expect(coachPlan(request({ goal: 'sleep' }))).toMatchObject({
      state: 'sleep',
      minutes: 45,
    });
    expect(coachPlan(request({ goal: 'meditate' }))!.state).toBe('meditation');
    expect(coachPlan(request({ goal: 'energize' }))!.state).toBe('energy');
    expect(coachPlan(request({ goal: 'intimacy' }))).toMatchObject({
      state: 'arousal',
      minutes: 30,
    });
    expect(coachPlan(request({ goal: 'flow' }))).toMatchObject({
      state: 'flow',
      minutes: 90,
    });
    expect(coachPlan(request({ goal: 'calm' }))).toMatchObject({
      state: 'calm',
      minutes: 15,
    });
    expect(coachPlan(request({ goal: 'create' }))).toMatchObject({
      state: 'creative',
      minutes: 45,
    });
  });

  it('an explicit duration wins over the state default', () => {
    expect(coachPlan(request({ durationMin: 120 }))!.minutes).toBe(120);
  });

  it('bumps intensity when energy pushes against the goal', () => {
    const base = coachPlan(request())!.intensity;
    const tiredFocus = coachPlan(request({ energy: 'low' }))!.intensity;
    expect(tiredFocus).toBeCloseTo(base + ENERGY_MISMATCH_INTENSITY_BUMP, 5);

    const wiredRelax = coachPlan(request({ goal: 'relax', energy: 'high' }))!;
    const calmRelax = coachPlan(request({ goal: 'relax' }))!;
    expect(wiredRelax.intensity).toBeCloseTo(
      calmRelax.intensity + ENERGY_MISMATCH_INTENSITY_BUMP,
      5,
    );

    // Aligned energy leaves intensity alone.
    expect(coachPlan(request({ goal: 'relax', energy: 'low' }))!.intensity).toBe(
      calmRelax.intensity,
    );

    const wiredIntimacy = coachPlan(request({ goal: 'intimacy', energy: 'high' }))!;
    const calmIntimacy = coachPlan(request({ goal: 'intimacy' }))!;
    expect(wiredIntimacy.intensity).toBeCloseTo(
      calmIntimacy.intensity + ENERGY_MISMATCH_INTENSITY_BUMP,
      5,
    );

    const wiredCalm = coachPlan(request({ goal: 'calm', energy: 'high' }))!;
    const restedCalm = coachPlan(request({ goal: 'calm' }))!;
    expect(wiredCalm.intensity).toBeCloseTo(
      restedCalm.intensity + ENERGY_MISMATCH_INTENSITY_BUMP,
      5,
    );

    const tiredFlow = coachPlan(request({ goal: 'flow', energy: 'low' }))!;
    const restedFlow = coachPlan(request({ goal: 'flow' }))!;
    expect(tiredFlow.intensity).toBeCloseTo(
      restedFlow.intensity + ENERGY_MISMATCH_INTENSITY_BUMP,
      5,
    );
  });

  it('the PRD example lands on focus at desired_arousal ≈ 0.55 + tiredness bump', () => {
    const plan = coachPlan(request({ goal: 'study', energy: 'low', durationMin: 120 }))!;
    expect(plan.state).toBe('focus');
    expect(plan.minutes).toBe(120);
    expect(plan.intensity).toBeCloseTo(0.55 + ENERGY_MISMATCH_INTENSITY_BUMP, 5);
  });

  it('clamps intensity into [0, 1]', () => {
    const plan = coachPlan(request({ goal: 'energize', energy: 'low', desiredArousal: 0.95 }))!;
    expect(plan.intensity).toBeLessThanOrEqual(1);
  });
});
