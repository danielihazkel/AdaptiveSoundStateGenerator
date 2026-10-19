// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STATES } from '../audio/states';
import type { SessionSnapshot } from '../session/sessionController';
import { SessionScreen } from './SessionScreen';

function renderSession(snapshot: Partial<SessionSnapshot> = {}) {
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

  it('hides the volume slider once the session is over', () => {
    renderSession({ phase: 'finished' });
    expect(screen.queryByRole('slider', { name: /volume/i })).toBeNull();
  });
});
