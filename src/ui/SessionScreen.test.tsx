// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STATES } from '../audio/states';
import type { SoundExplanation } from '../personalization/explain';
import type { SessionSnapshot } from '../session/sessionController';
import { SessionScreen } from './SessionScreen';

function renderSession(
  snapshot: Partial<SessionSnapshot> = {},
  extra: { explanation?: SoundExplanation } = {},
) {
  const onProfileChange = vi.fn();
  const profile = STATES.focus.buildProfile(0.5);
  render(
    <SessionScreen
      stateDef={STATES.focus}
      snapshot={{ phase: 'running', elapsedSec: 0, remainingSec: 600, ...snapshot }}
      profile={profile}
      onProfileChange={onProfileChange}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onStop={vi.fn()}
      onDismissAlarm={vi.fn()}
      onSnooze={vi.fn()}
      onSavePreset={vi.fn()}
      explanation={extra.explanation}
    />,
  );
  return { onProfileChange, profile };
}

describe('SessionScreen', () => {
  it('shows a volume slider outside the collapsed sound parameters', () => {
    const { onProfileChange, profile } = renderSession();
    const slider = screen.getByRole('slider', { name: /volume/i });
    fireEvent.change(slider, { target: { value: '0.7' } });
    expect(onProfileChange).toHaveBeenCalledTimes(1);
    const next = onProfileChange.mock.calls[0][0];
    // Only the volume moves — the orchestrator relies on that to keep a
    // volume change from counting as a customization.
    expect(next).toEqual({ ...profile, masterVolume: 0.7 });
  });

  it('arrow keys step the volume from the page', () => {
    const { onProfileChange, profile } = renderSession();
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(onProfileChange.mock.calls[0][0].masterVolume).toBeCloseTo(profile.masterVolume + 0.05);
  });

  it('says why this sound plays, with the score one tap away', () => {
    renderSession({}, { explanation: { label: 'Warmer tone', reason: 'Trying a variation', scorePct: 71, ciPct: 12 } });
    const toggle = screen.getByRole('button', { name: 'Warmer tone · Trying a variation' });
    expect(screen.queryByText(/Scores 71%/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Scores 71% ±12 for you so far/)).toBeTruthy();
  });

  it('shows no explanation line when there is none', () => {
    renderSession();
    expect(screen.queryByRole('button', { name: /·/ })).toBeNull();
  });

  it('hides the volume slider once the session is over', () => {
    renderSession({ phase: 'finished' });
    expect(screen.queryByRole('slider', { name: /volume/i })).toBeNull();
  });
});
