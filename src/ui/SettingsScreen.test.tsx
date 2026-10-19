// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Settings } from '../storage/types';
import { SettingsScreen } from './SettingsScreen';

function renderSettings(settings: Partial<Settings> = {}) {
  const handlers = { onChange: vi.fn(), onReplayTour: vi.fn(), onBack: vi.fn() };
  render(
    <SettingsScreen
      settings={{ ...defaultSettings, ...settings }}
      {...handlers}
      data={<p>data panel</p>}
    />,
  );
  return handlers;
}

describe('SettingsScreen', () => {
  it('reflects the current settings with their defaults', () => {
    renderSettings();
    expect(screen.getByRole('checkbox', { name: /adapt mid-session/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sleep sessions' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('data panel')).toBeInTheDocument();
  });

  it('writes each change back as a partial update', async () => {
    const user = userEvent.setup();
    const h = renderSettings();
    await user.click(screen.getByRole('checkbox', { name: /adapt mid-session/i }));
    expect(h.onChange).toHaveBeenLastCalledWith({ adaptationEnabled: false });
    await user.click(screen.getByRole('radio', { name: 'Never' }));
    expect(h.onChange).toHaveBeenLastCalledWith({ nightstand: 'never' });
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(h.onChange).toHaveBeenLastCalledWith({ theme: 'light' });
  });

  it('can replay the tour and go back', async () => {
    const user = userEvent.setup();
    const h = renderSettings();
    await user.click(screen.getByRole('button', { name: /intro tour/i }));
    expect(h.onReplayTour).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(h.onBack).toHaveBeenCalledTimes(1);
  });
});
