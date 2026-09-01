// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackScreen } from './FeedbackScreen';

function renderScreen(overrides: Partial<Parameters<typeof FeedbackScreen>[0]> = {}) {
  const props = {
    stateLabel: 'Focus',
    completed: true,
    onRate: vi.fn(),
    onSkip: vi.fn(),
    onSavePreset: vi.fn(),
    ...overrides,
  };
  render(<FeedbackScreen {...props} />);
  return props;
}

describe('FeedbackScreen', () => {
  it('submits on the rating tap — one scale, no extra confirm', async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    expect(screen.getByRole('heading', { name: 'Session complete' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '4' }));
    expect(props.onRate).toHaveBeenCalledTimes(1);
    expect(props.onRate).toHaveBeenCalledWith({ rating: 4 });
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it('skip is separate from rating', async () => {
    const user = userEvent.setup();
    const props = renderScreen({ completed: false });
    expect(screen.getByRole('heading', { name: 'Session stopped' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onRate).not.toHaveBeenCalled();
  });

  it('the optional PRD §9 chips travel with the rating and can be toggled off', async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    await user.click(screen.getByRole('radio', { name: 'Very' }));
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.getByRole('radio', { name: 'Very' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'No' })); // toggle off
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(props.onRate).toHaveBeenCalledWith({ rating: 3, distraction: 3, useAgain: true });
  });

  it('chip rows are keyboard radio groups', async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    const notAtAll = screen.getByRole('radio', { name: 'Not at all' });
    notAtAll.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'A little' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(props.onRate).toHaveBeenCalledWith({ rating: 5, distraction: 2 });
  });

  it('offers to save the sound as a preset named after the state', () => {
    renderScreen({ stateLabel: 'Relax' });
    expect(screen.getByDisplayValue('Relax session')).toBeInTheDocument();
  });
});
