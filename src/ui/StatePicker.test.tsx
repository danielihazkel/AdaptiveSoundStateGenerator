// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { STATE_LIST, type MentalState } from '../audio/states';
import { StatePicker } from './StatePicker';

/** Controlled wrapper so arrow keys can move the selection like in the app. */
function Harness({ initial = 'focus' }: { initial?: MentalState }) {
  const [value, setValue] = useState<MentalState>(initial);
  return <StatePicker value={value} onChange={setValue} />;
}

describe('StatePicker (useRadioGroup)', () => {
  it('is a radio group with exactly one checked item in the tab order', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'What do you want to feel?' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeInTheDocument();
    expect(radios).toHaveLength(STATE_LIST.length);
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent('Focus');
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual(checked);
  });

  it('arrow keys move selection and focus, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const first = screen.getByRole('radio', { name: /Focus/ });
    first.focus();
    await user.keyboard('{ArrowRight}');
    const second = screen.getByRole('radio', { name: new RegExp(STATE_LIST[1].label) });
    expect(second).toHaveAttribute('aria-checked', 'true');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    const last = screen.getByRole('radio', {
      name: new RegExp(STATE_LIST[STATE_LIST.length - 1].label),
    });
    expect(last).toHaveAttribute('aria-checked', 'true');
    expect(last).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{End}');
    expect(last).toHaveAttribute('aria-checked', 'true');
  });

  it('click selects', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('radio', { name: /Sleep/ }));
    expect(screen.getByRole('radio', { name: /Sleep/ })).toHaveAttribute('aria-checked', 'true');
  });
});
