import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { Preset, SessionRecord } from '../storage/types';
import { makeSourceArmResolver } from './sourceArm';

function record(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'x',
    startedAt: '2026-08-20T22:00:00.000Z',
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
    ...overrides,
  };
}

const served = record({ id: 'served', servedArmId: 'noise-up', servedBy: 'bandit' });
const adapted = record({
  id: 'adapted',
  servedArmId: 'prior',
  servedBy: 'bandit',
  segments: [
    { armId: 'prior', startSec: 0, endSec: 600, response: 'worse', volumeAdjustments: 0 },
    { armId: 'beat-down', startSec: 600, endSec: 1800, volumeAdjustments: 0 },
  ],
});
const customized = record({ id: 'custom', servedArmId: 'iso-off', servedBy: 'bandit', customized: true });
const replayOfServed = record({ id: 'replay1', replayOfSessionId: 'served' });
const preset: Preset = {
  id: 'p1',
  name: 'Mine',
  createdAt: '2026-08-21T00:00:00.000Z',
  state: 'focus',
  intensity: 0.5,
  profile: STATES.focus.buildProfile(0.5),
  sourceSessionId: 'served',
};

describe('makeSourceArmResolver', () => {
  const resolve = makeSourceArmResolver(
    [served, adapted, customized, replayOfServed],
    [preset, { ...preset, id: 'p-relax', state: 'relax' }, { ...preset, id: 'p-orphan', sourceSessionId: undefined }],
  );

  it('a replay credits the served arm of its source', () => {
    expect(resolve(record({ replayOfSessionId: 'served' }))).toEqual({ state: 'focus', armId: 'noise-up' });
  });

  it('a replay of an adapted session credits the arm that played last', () => {
    expect(resolve(record({ replayOfSessionId: 'adapted' }))).toEqual({ state: 'focus', armId: 'beat-down' });
  });

  it('follows a replay chain back to the served session', () => {
    expect(resolve(record({ replayOfSessionId: 'replay1' }))).toEqual({ state: 'focus', armId: 'noise-up' });
  });

  it('a preset saved from a session credits that session\'s arm', () => {
    expect(resolve(record({ presetId: 'p1' }))).toEqual({ state: 'focus', armId: 'noise-up' });
  });

  it('refuses unclean labels: customized source, other state, unknown, orphan preset', () => {
    expect(resolve(record({ replayOfSessionId: 'custom' }))).toBeNull();
    expect(resolve(record({ replayOfSessionId: 'served', state: 'relax' }))).toBeNull();
    expect(resolve(record({ replayOfSessionId: 'nope' }))).toBeNull();
    expect(resolve(record({ presetId: 'p-relax' }))).toBeNull();
    expect(resolve(record({ presetId: 'p-orphan' }))).toBeNull();
    expect(resolve(record({ presetId: 'missing' }))).toBeNull();
    expect(resolve(record({}))).toBeNull();
  });
});
