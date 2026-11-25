import { describe, expect, it } from 'vitest';
import { parseQuickStart } from '../app/useQuickStart';
import { pendingFromIncomingFile } from '../app/useShareImport';
import { STATES } from '../audio/states';
import { quickStartSearchFromUrl } from './nativeIncoming';

describe('quickStartSearchFromUrl', () => {
  it('turns a launcher-shortcut link into the quick-start query', () => {
    const search = quickStartSearchFromUrl('resonance://start?start=focus&minutes=25');
    expect(search).toBe('?start=focus&minutes=25');
    expect(parseQuickStart(search!)).toEqual({ kind: 'state', state: 'focus', minutes: 25 });
  });

  it('ignores other schemes, hosts and empty queries', () => {
    expect(quickStartSearchFromUrl('content://media/external/downloads/9')).toBeNull();
    expect(quickStartSearchFromUrl('https://example.com/?start=focus')).toBeNull();
    expect(quickStartSearchFromUrl('resonance://other?start=focus')).toBeNull();
    expect(quickStartSearchFromUrl('resonance://start')).toBeNull();
    expect(quickStartSearchFromUrl('not a url')).toBeNull();
  });
});

describe('pendingFromIncomingFile', () => {
  const preset = {
    v: 1,
    kind: 'preset',
    preset: {
      name: 'Shared rain',
      state: 'relax',
      intensity: 0.4,
      profile: STATES.relax.buildProfile(0.4),
    },
  };

  it('offers a valid share payload for import', () => {
    const pending = pendingFromIncomingFile({ name: 'a.resonance.json', text: JSON.stringify(preset) });
    expect(pending).toMatchObject({ payload: { kind: 'preset', preset: { name: 'Shared rain' } } });
  });

  it('explains files it will not import here', () => {
    expect(pendingFromIncomingFile({ name: 'x', error: 'That file could not be read.' })).toEqual({
      error: 'That file could not be read.',
    });
    expect(pendingFromIncomingFile({ name: 'x', text: '{oops' })).toEqual({
      error: 'That file is not valid JSON.',
    });
    const backup = pendingFromIncomingFile({
      name: 'resonance-export.json',
      text: JSON.stringify({ version: 1, sessions: [] }),
    });
    expect('error' in backup && backup.error).toMatch(/full backup/);
  });

  it('rejects a payload that fails validation', () => {
    const bad = { v: 1, kind: 'preset', preset: { name: 'x', state: 'nope', intensity: 0.5, profile: {} } };
    expect(pendingFromIncomingFile({ name: 'x', text: JSON.stringify(bad) })).toHaveProperty('error');
  });
});
