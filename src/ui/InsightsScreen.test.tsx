// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STATES } from '../audio/states';
import { updateArm } from '../personalization/bandit';
import { CANDIDATE_SET_VERSION } from '../personalization/candidates';
import { computeInsights, MIN_SESSIONS_FOR_INSIGHTS } from '../personalization/insights';
import { SCHEMA_VERSION, type PersonalizationState, type SessionRecord } from '../storage/types';
import { InsightsScreen } from './InsightsScreen';

function focusSession(intensity: number): SessionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    startedAt: '2026-08-20T10:00:00.000Z',
    state: 'focus',
    intensity,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(intensity),
    servedArmId: 'prior',
    servedBy: 'bandit',
  };
}

function insights() {
  let bandit: PersonalizationState = {
    schemaVersion: SCHEMA_VERSION,
    candidateSetVersion: CANDIDATE_SET_VERSION,
    arms: {},
  };
  bandit = updateArm(bandit, 'focus', 'bass-up', { value: 0.8, weight: 1 });
  // Newest first: the latest session ran at depth 0.7.
  const sessions = [focusSession(0.7), ...Array.from({ length: MIN_SESSIONS_FOR_INSIGHTS }, () => focusSession(0.3))];
  return computeInsights(sessions, bandit);
}

describe('InsightsScreen', () => {
  it('"Try" plays a variation from the table (Phase 15)', () => {
    const onTryArm = vi.fn();
    const data = insights();
    expect(data[0].lastIntensity).toBe(0.7);
    render(<InsightsScreen insights={data} onBack={vi.fn()} onTryArm={onTryArm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try More bass for focus' }));
    expect(onTryArm).toHaveBeenCalledWith('focus', 'bass-up');
  });

  it('disables Try while a session is starting, and has no Try without a handler', () => {
    const data = insights();
    const { unmount } = render(
      <InsightsScreen insights={data} onBack={vi.fn()} onTryArm={vi.fn()} starting />,
    );
    expect(screen.getByRole('button', { name: 'Try More bass for focus' })).toHaveProperty('disabled', true);
    unmount();
    render(<InsightsScreen insights={data} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Try / })).toBeNull();
  });
});
