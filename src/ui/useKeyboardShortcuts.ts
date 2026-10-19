import { useEffect } from 'react';
import { useStableCallback } from '../app/useStableCallback';

/**
 * Elements that already own these keys: typing, native button activation
 * (Space on a focused Pause button must not also toggle via the shortcut),
 * slider arrows, radio-group arrows.
 */
const OWNS_KEYS =
  'input, select, textarea, button, a[href], [contenteditable=""], [contenteditable="true"], [role="radio"], [role="slider"], [role="button"], [role="option"]';

export function shortcutTargetAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target.closest(OWNS_KEYS) === null;
}

/**
 * Document-level single-key shortcuts, keyed by `KeyboardEvent.key`
 * (' ' for Space). Ignored with a modifier held, while focus is somewhere
 * that owns the key, or while a modal dialog is open. A handled key's
 * default (page scroll for Space / arrows) is suppressed.
 */
export function useKeyboardShortcuts(
  bindings: Partial<Record<string, () => void>>,
  enabled = true,
): void {
  const run = useStableCallback((e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!shortcutTargetAllowed(e.target)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const action = bindings[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  });

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', run);
    return () => document.removeEventListener('keydown', run);
  }, [enabled, run]);
}
