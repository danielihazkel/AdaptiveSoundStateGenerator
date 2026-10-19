// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STATES } from '../audio/states';
import type { SessionRecord } from '../storage/types';
import { HistoryScreen } from './HistoryScreen';

function session(daysAgo: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
  const startedAt = new Date(Date.now() - daysAgo * 86_400_000 - 3_600_000).toISOString();
  return {
    id: `${daysAgo}-${Math.random()}`,
    startedAt,
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
    feedback: { rating: 4, ratedAt: startedAt },
    ...overrides,
  };
}

function renderHistory(sessions: SessionRecord[]) {
  render(
    <HistoryScreen
      sessions={sessions}
      programs={[]}
      presets={[]}
      onReplay={vi.fn()}
      onUseProgram={vi.fn()}
      onBack={vi.fn()}
    />,
  );
}

describe('HistoryScreen weekly card', () => {
  it('shows the week once it has enough sessions', () => {
    renderHistory([session(0), session(1), session(2, { state: 'calm' }), session(9)]);
    const card = screen.getByRole('region', { name: 'This week' });
    expect(card).toHaveTextContent('3 sessions, 1 h 30 min');
    expect(card).toHaveTextContent('200% more than the week before');
    expect(card).toHaveTextContent(/Mostly 🎯 focus \(1 h\)/);
    expect(card).toHaveTextContent('Rated 4.0 on average');
  });

  it('stays hidden on a light week', () => {
    renderHistory([session(0), session(1)]);
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull();
  });
});
