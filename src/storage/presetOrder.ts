import type { Preset } from './types';

/**
 * Presets are stored as one ordered list (newest first on save). Favorites
 * float to the top of their state's strip; within favorites and within the
 * rest, list order is the user's order.
 */
export function sortForDisplay<T extends Pick<Preset, 'favorite'>>(presets: readonly T[]): T[] {
  const favorites = presets.filter((p) => p.favorite === true);
  const rest = presets.filter((p) => p.favorite !== true);
  return [...favorites, ...rest];
}

/**
 * Move a preset one step within its state's displayed strip. Only neighbours
 * in the same group (favorite / not) swap, so a favorite never "moves" past
 * a non-favorite it is already shown above. Returns the same array when the
 * move is a no-op (edge of the group, unknown id).
 */
export function movePreset(all: readonly Preset[], id: string, direction: -1 | 1): Preset[] {
  const target = all.find((p) => p.id === id);
  if (!target) return all.slice();
  const strip = sortForDisplay(all.filter((p) => p.state === target.state));
  const at = strip.findIndex((p) => p.id === id);
  const neighbour = strip[at + direction];
  if (!neighbour || (neighbour.favorite === true) !== (target.favorite === true)) return all.slice();
  const a = all.findIndex((p) => p.id === target.id);
  const b = all.findIndex((p) => p.id === neighbour.id);
  const next = all.slice();
  next[a] = neighbour;
  next[b] = target;
  return next;
}
