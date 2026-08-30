import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { defaultProgram } from '../programs/types';
import {
  appendSession,
  clearStorageFailure,
  getStorageFailure,
  onStorageFailure,
  attachFeedback,
  deletePreset,
  deleteProgram,
  emptyPersonalization,
  loadPersonalization,
  loadPresets,
  loadPrograms,
  loadSessions,
  loadSettings,
  markBanditResolved,
  markFeedbackSkipped,
  newId,
  QUARANTINE_SUFFIX,
  savePersonalization,
  savePreset,
  saveProgram,
  saveSettings,
} from './storage';
import { defaultSettings, modeFor, SCHEMA_VERSION, type Preset, type SessionRecord } from './types';

// Node has no localStorage — a Map-backed stand-in matching the parts we use.
function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: newId(),
    name: 'Evening focus',
    createdAt: new Date().toISOString(),
    state: 'focus',
    intensity: 0.6,
    profile: STATES.focus.buildProfile(0.6),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: newId(),
    startedAt: new Date().toISOString(),
    state: 'relax',
    intensity: 0.4,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.relax.buildProfile(0.4),
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

describe('settings', () => {
  it('returns defaults when nothing stored', () => {
    expect(loadSettings()).toEqual(defaultSettings);
  });

  it('round-trips', () => {
    saveSettings({ ...defaultSettings, monoMode: true, chimeEnabled: false });
    expect(loadSettings()).toMatchObject({ monoMode: true, chimeEnabled: false });
  });

  it('falls back to defaults on corrupt payload', () => {
    localStorage.setItem('resonance.v1.settings', '{not json');
    expect(loadSettings()).toEqual(defaultSettings);
    localStorage.setItem('resonance.v1.settings', JSON.stringify({ schemaVersion: 99 }));
    expect(loadSettings()).toEqual(defaultSettings);
  });
});

describe('presets', () => {
  it('round-trips, replaces by id, and deletes', () => {
    const preset = makePreset();
    savePreset(preset);
    expect(loadPresets()).toEqual([preset]);

    savePreset({ ...preset, name: 'Renamed' });
    expect(loadPresets()).toHaveLength(1);
    expect(loadPresets()[0].name).toBe('Renamed');

    deletePreset(preset.id);
    expect(loadPresets()).toEqual([]);
  });

  it('recovers from a corrupt key without crashing', () => {
    localStorage.setItem('resonance.v1.presets', '"a string"');
    expect(loadPresets()).toEqual([]);
    const preset = makePreset();
    savePreset(preset);
    expect(loadPresets()).toEqual([preset]);
  });
});

describe('programs', () => {
  it('round-trips, replaces by id, and deletes', () => {
    const program = defaultProgram('focus', 0.5);
    saveProgram(program);
    expect(loadPrograms()).toEqual([program]);

    saveProgram({ ...program, name: 'Morning build' });
    expect(loadPrograms()).toHaveLength(1);
    expect(loadPrograms()[0].name).toBe('Morning build');

    deleteProgram(program.id);
    expect(loadPrograms()).toEqual([]);
  });

  it('normalizes partial stored programs on read', () => {
    const program = defaultProgram('relax', 0.5);
    const stripped = structuredClone(program) as unknown as Record<string, unknown>;
    delete (stripped.segments as Record<string, unknown>[])[0].intensity;
    delete stripped.baseProfile;
    localStorage.setItem(
      'resonance.v1.programs',
      JSON.stringify({ schemaVersion: 1, items: [stripped] }),
    );
    const loaded = loadPrograms()[0];
    expect(loaded.segments[0].intensity).toBe(0.5);
    expect(loaded.baseProfile).toEqual(STATES.relax.buildProfile(0.5));
  });

  it('recovers from a corrupt key without crashing', () => {
    localStorage.setItem('resonance.v1.programs', '"a string"');
    expect(loadPrograms()).toEqual([]);
  });
});

describe('sessions', () => {
  it('appends newest-first and attaches feedback', () => {
    const a = makeSession();
    const b = makeSession();
    appendSession(a);
    appendSession(b);
    expect(loadSessions().map((s) => s.id)).toEqual([b.id, a.id]);

    attachFeedback(a.id, 4);
    const stored = loadSessions().find((s) => s.id === a.id);
    expect(stored?.feedback?.rating).toBe(4);
  });

  it('ignores feedback for unknown sessions', () => {
    appendSession(makeSession());
    expect(() => attachFeedback('nope', 5)).not.toThrow();
  });

  it('caps stored records at 500', () => {
    for (let i = 0; i < 505; i++) appendSession(makeSession());
    expect(loadSessions()).toHaveLength(500);
  });

  it('marks feedback skipped and bandit resolved; unknown ids are no-ops', () => {
    const session = makeSession();
    appendSession(session);

    markFeedbackSkipped(session.id);
    markBanditResolved(session.id);
    const stored = loadSessions()[0];
    expect(stored.feedbackSkipped).toBe(true);
    expect(typeof stored.banditResolvedAt).toBe('string');

    expect(() => markFeedbackSkipped('nope')).not.toThrow();
    expect(() => markBanditResolved('nope')).not.toThrow();
  });

  it('still parses pre-Phase-2 records without the new optional fields', () => {
    appendSession(makeSession());
    const stored = loadSessions()[0];
    expect(stored.servedArmId).toBeUndefined();
    expect(stored.servedBy).toBeUndefined();
  });
});

describe('personalization', () => {
  it('returns empty state when nothing stored', () => {
    expect(loadPersonalization(1)).toEqual(emptyPersonalization(1));
  });

  it('round-trips arm stats', () => {
    const state = emptyPersonalization(1);
    state.arms.focus = { prior: { n: 2, sum: 1.2, sumSq: 0.74 } };
    savePersonalization(state);
    expect(loadPersonalization(1)).toEqual(state);
  });

  it('resets on corrupt payload or candidate-set version mismatch', () => {
    localStorage.setItem('resonance.v1.personalization', '{not json');
    expect(loadPersonalization(1)).toEqual(emptyPersonalization(1));

    savePersonalization({ ...emptyPersonalization(1), arms: { focus: {} } });
    expect(loadPersonalization(2)).toEqual(emptyPersonalization(2));
  });
});

describe('personalization mode', () => {
  it('defaults to explore and round-trips a per-state lock', () => {
    expect(modeFor(defaultSettings, 'focus')).toBe('explore');
    saveSettings({ ...defaultSettings, personalizationMode: { sleep: 'locked' } });
    const settings = loadSettings();
    expect(modeFor(settings, 'sleep')).toBe('locked');
    expect(modeFor(settings, 'focus')).toBe('explore');
  });

  it('tolerates settings saved before the personalizationMode field existed', () => {
    const { personalizationMode: _drop, ...legacy } = defaultSettings;
    localStorage.setItem('resonance.v1.settings', JSON.stringify(legacy));
    expect(modeFor(loadSettings(), 'focus')).toBe('explore');
  });
});

describe('storage failure reporting', () => {
  it('reports a failed write to the listener and getStorageFailure', () => {
    clearStorageFailure();
    const throwing = fakeLocalStorage();
    throwing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    globalThis.localStorage = throwing;
    const seen: string[] = [];
    const off = onStorageFailure((f) => seen.push(f.key));
    saveSettings(defaultSettings);
    expect(seen).toHaveLength(1);
    expect(getStorageFailure()?.key).toBe(seen[0]);
    off();
    saveSettings(defaultSettings);
    expect(seen).toHaveLength(1); // unsubscribed
    clearStorageFailure();
    expect(getStorageFailure()).toBeNull();
  });

  it('stays null when writes succeed', () => {
    clearStorageFailure();
    globalThis.localStorage = fakeLocalStorage();
    saveSettings(defaultSettings);
    expect(getStorageFailure()).toBeNull();
  });

  it('fans out to every subscriber; each unsubscribes independently', () => {
    clearStorageFailure();
    const throwing = fakeLocalStorage();
    throwing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    globalThis.localStorage = throwing;
    const a: string[] = [];
    const b: string[] = [];
    const offA = onStorageFailure((f) => a.push(f.kind));
    const offB = onStorageFailure((f) => b.push(f.kind));
    saveSettings(defaultSettings);
    expect(a).toEqual(['write']);
    expect(b).toEqual(['write']);
    offA();
    saveSettings(defaultSettings);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    offB();
    clearStorageFailure();
  });
});

describe('schema forward-compatibility', () => {
  const PRESETS = 'resonance.v1.presets';
  const Q = PRESETS + QUARANTINE_SUFFIX;

  afterEach(() => clearStorageFailure());

  it('never wipes a list written by a newer schema; quarantines a copy and reports it', () => {
    const newer = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, items: [{ id: 'x' }] });
    localStorage.setItem(PRESETS, newer);
    const seen: string[] = [];
    const off = onStorageFailure((f) => seen.push(`${f.kind}:${f.key}`));
    expect(loadPresets()).toEqual([]);
    off();
    expect(localStorage.getItem(PRESETS)).toBe(newer); // untouched
    expect(localStorage.getItem(Q)).toBe(newer);
    expect(seen).toEqual([`incompatible:${PRESETS}`]);
    expect(getStorageFailure()?.kind).toBe('incompatible');
  });

  it('quarantines a corrupt list before resetting it', () => {
    localStorage.setItem(PRESETS, '{not json');
    const seen: string[] = [];
    const off = onStorageFailure((f) => seen.push(f.kind));
    expect(loadPresets()).toEqual([]);
    off();
    expect(localStorage.getItem(Q)).toBe('{not json');
    expect(JSON.parse(localStorage.getItem(PRESETS)!)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      items: [],
    });
    expect(seen).toEqual(['corrupt']);
  });

  it('a stamped payload with the wrong shape counts as corrupt', () => {
    localStorage.setItem(PRESETS, JSON.stringify({ schemaVersion: SCHEMA_VERSION, items: 'no' }));
    expect(loadPresets()).toEqual([]);
    expect(getStorageFailure()?.kind).toBe('corrupt');
  });

  it('the first quarantined payload is never overwritten', () => {
    localStorage.setItem(PRESETS, '"first"');
    loadPresets();
    localStorage.setItem(PRESETS, '"second"');
    loadPresets();
    expect(localStorage.getItem(Q)).toBe('"first"');
  });

  it('keeps newer settings and personalization aside too', () => {
    localStorage.setItem(
      'resonance.v1.settings',
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, monoMode: true }),
    );
    expect(loadSettings()).toEqual(defaultSettings);
    expect(localStorage.getItem('resonance.v1.settings' + QUARANTINE_SUFFIX)).not.toBeNull();

    localStorage.setItem(
      'resonance.v1.personalization',
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, candidateSetVersion: 1, arms: {} }),
    );
    expect(loadPersonalization(1)).toEqual(emptyPersonalization(1));
    expect(
      localStorage.getItem('resonance.v1.personalization' + QUARANTINE_SUFFIX),
    ).not.toBeNull();
  });
});
