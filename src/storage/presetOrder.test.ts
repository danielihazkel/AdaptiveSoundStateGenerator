import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { movePreset, sortForDisplay } from './presetOrder';
import type { Preset } from './types';

function preset(id: string, state: Preset['state'], favorite?: boolean): Preset {
  return {
    id,
    name: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    state,
    intensity: 0.5,
    profile: STATES[state].buildProfile(0.5),
    ...(favorite === undefined ? {} : { favorite }),
  };
}

const ids = (list: readonly Preset[]) => list.map((p) => p.id);

describe('sortForDisplay', () => {
  it('floats favorites to the top and keeps list order within each group', () => {
    const list = [preset('a', 'focus'), preset('b', 'focus', true), preset('c', 'focus'), preset('d', 'focus', true)];
    expect(ids(sortForDisplay(list))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is stable for a list without favorites', () => {
    const list = [preset('a', 'focus'), preset('b', 'focus', false)];
    expect(ids(sortForDisplay(list))).toEqual(['a', 'b']);
  });
});

describe('movePreset', () => {
  const list = [
    preset('a', 'focus'),
    preset('x', 'sleep'),
    preset('b', 'focus', true),
    preset('c', 'focus'),
    preset('d', 'focus', true),
  ];

  it('swaps with the displayed neighbour of the same group, across other states', () => {
    const next = movePreset(list, 'c', -1);
    expect(ids(next)).toEqual(['c', 'x', 'b', 'a', 'd']);
    expect(ids(sortForDisplay(next.filter((p) => p.state === 'focus')))).toEqual(['b', 'd', 'c', 'a']);
  });

  it('moves favorites among favorites only', () => {
    expect(ids(sortForDisplay(movePreset(list, 'd', -1).filter((p) => p.state === 'focus')))).toEqual([
      'd',
      'b',
      'a',
      'c',
    ]);
    // 'd' is the last favorite; moving it down would cross into non-favorites.
    expect(ids(movePreset(list, 'd', 1))).toEqual(ids(list));
  });

  it('is a no-op at the edges and for unknown ids', () => {
    expect(ids(movePreset(list, 'b', -1))).toEqual(ids(list));
    expect(ids(movePreset(list, 'c', 1))).toEqual(ids(list));
    expect(ids(movePreset(list, 'nope', 1))).toEqual(ids(list));
  });

  it('never mutates its input', () => {
    const before = ids(list);
    movePreset(list, 'c', -1);
    expect(ids(list)).toEqual(before);
  });
});
