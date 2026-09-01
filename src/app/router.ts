import type { Screen } from './types';

/**
 * Screen ↔ URL-hash mapping. Screens are conditionally rendered, so the hash
 * is a mirror of `screen` that makes the browser Back button work — not a
 * router that owns state.
 *
 * Only the sub-screens the user opens from setup get a history entry. The
 * session and feedback screens never do: Back must not be able to drop
 * someone out of a running session, and there is nothing to go "back" to
 * from a rating prompt.
 */
const HASHES: Readonly<Partial<Record<Screen, string>>> = {
  history: '#history',
  insights: '#insights',
  lab: '#lab',
  programEditor: '#program',
};

/** Screens that get their own history entry. */
export const NAVIGABLE: ReadonlySet<Screen> = new Set(Object.keys(HASHES) as Screen[]);

/** Screens where a history navigation is refused (reversed) rather than followed. */
export const LOCKED: ReadonlySet<Screen> = new Set<Screen>(['session', 'feedback']);

export function hashForScreen(screen: Screen): string {
  return HASHES[screen] ?? '';
}

/**
 * Returns the screen a hash names; `setup` for an empty hash; null for
 * anything unknown — including `#share=` tokens, which belong to the share
 * importer and must never be mistaken for a screen.
 */
export function screenForHash(hash: string): Screen | null {
  const clean = hash.startsWith('#') ? hash : `#${hash}`;
  if (clean === '#') return 'setup';
  if (clean.includes('=')) return null;
  for (const [screen, value] of Object.entries(HASHES)) {
    if (value === clean) return screen as Screen;
  }
  return null;
}
