import type { KeyboardEvent } from 'react';

/**
 * Props for a WAI-ARIA radio group built from buttons: roving tabIndex (only
 * the selected item is in the tab order) and arrow keys that move both the
 * selection and focus. Space/Enter still work through the button's click.
 */
export function useRadioGroup<T>(opts: {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Return the button element for an item so arrow keys can focus it. */
  getKey: (item: T) => string;
}) {
  const index = opts.items.findIndex((item) => item === opts.value);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    let delta = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') delta = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') delta = -1;
    else if (e.key === 'Home') delta = -index;
    else if (e.key === 'End') delta = opts.items.length - 1 - index;
    else return;
    e.preventDefault();
    const n = opts.items.length;
    const next = opts.items[(((index < 0 ? 0 : index) + delta) % n + n) % n];
    opts.onChange(next);
    const group = e.currentTarget.closest('[role="radiogroup"]');
    const el = group?.querySelector<HTMLElement>(`[data-radio-key="${opts.getKey(next)}"]`);
    el?.focus();
  };
  return {
    groupProps: { role: 'radiogroup' as const },
    itemProps: (item: T) => {
      const selected = item === opts.value;
      return {
        role: 'radio' as const,
        'aria-checked': selected,
        tabIndex: selected || (index < 0 && item === opts.items[0]) ? 0 : -1,
        'data-radio-key': opts.getKey(item),
        onKeyDown,
      };
    },
  };
}
