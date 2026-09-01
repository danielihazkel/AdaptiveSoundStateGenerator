// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MorningPromptModal } from './MorningPrompt';

function Page({ open, onDismiss, onRate }: { open: boolean; onDismiss: () => void; onRate: () => void }) {
  return (
    <>
      <button type="button">Opener</button>
      {open && <MorningPromptModal onRate={onRate} onDismiss={onDismiss} />}
    </>
  );
}

describe('useDialog via MorningPromptModal', () => {
  it('moves focus inside on open and restores it to the opener on close', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Page open={false} onDismiss={onDismiss} onRate={vi.fn()} />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    rerender(<Page open onDismiss={onDismiss} onRate={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Good morning' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Page open={false} onDismiss={onDismiss} onRate={vi.fn()} />);
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('traps Tab and Shift+Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(<Page open onDismiss={vi.fn()} onRate={vi.fn()} />);
    const first = screen.getByRole('button', { name: '1' });
    const last = screen.getByRole('button', { name: 'Skip' });
    expect(first).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(last).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(first).toHaveFocus();
    // The opener outside the dialog is never reached.
    for (let i = 0; i < 6; i += 1) await user.keyboard('{Tab}');
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('Escape dismisses', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Page open onDismiss={onDismiss} onRate={vi.fn()} />);
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a rating tap reports the rating', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    render(<Page open onDismiss={vi.fn()} onRate={onRate} />);
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(onRate).toHaveBeenCalledWith(5);
  });
});
