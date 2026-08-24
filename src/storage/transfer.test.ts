import { beforeEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { CANDIDATE_SET_VERSION, PRIOR_ARM_ID } from '../personalization/candidates';
import { defaultProgram } from '../programs/types';
import {
  appendSession,
  loadPersonalization,
  loadPresets,
  loadPrograms,
  loadSessions,
  loadSettings,
  newId,
  savePreset,
  saveProgram,
  saveSettings,
} from './storage';
import { buildExportBundle, importBundle, validateBundle } from './transfer';
import { defaultSettings, type Preset, type SessionRecord } from './types';

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

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: newId(),
    name: 'Deep work',
    createdAt: '2026-08-20T10:00:00.000Z',
    state: 'focus',
    intensity: 0.6,
    profile: STATES.focus.buildProfile(0.6),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: newId(),
    startedAt: '2026-08-20T10:00:00.000Z',
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
    servedArmId: PRIOR_ARM_ID,
    servedBy: 'bandit',
    feedback: { rating: 5, ratedAt: '2026-08-20T11:00:00.000Z' },
    banditResolvedAt: '2026-08-20T11:00:00.000Z',
    ...overrides,
  };
}

describe('validateBundle', () => {
  it('rejects non-Resonance and future-format payloads without touching storage', () => {
    expect(validateBundle(null).ok).toBe(false);
    expect(validateBundle('hello').ok).toBe(false);
    expect(validateBundle({ format: 'other-app' }).ok).toBe(false);
    const future = { ...buildExportBundle(), formatVersion: 2 };
    const result = validateBundle(future);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });

  it('rejects structurally damaged bundles', () => {
    const good = buildExportBundle();
    expect(validateBundle({ ...good, sessions: 'oops' }).ok).toBe(false);
    expect(validateBundle({ ...good, presets: [{ name: 'no id' }] }).ok).toBe(false);
    expect(validateBundle({ ...good, settings: null }).ok).toBe(false);
    expect(validateBundle({ ...good, programs: 'oops' }).ok).toBe(false);
    expect(validateBundle({ ...good, programs: [{ name: 'no id' }] }).ok).toBe(false);
  });

  it('accepts bundles exported before programs existed', () => {
    const legacy = { ...buildExportBundle() } as Record<string, unknown>;
    delete legacy.programs;
    expect(validateBundle(legacy).ok).toBe(true);
  });

  it('accepts a real export', () => {
    appendSession(makeSession());
    savePreset(makePreset());
    expect(validateBundle(buildExportBundle()).ok).toBe(true);
  });
});

describe('export → import round-trip', () => {
  it('restores sessions, presets, and a rebuilt bandit posterior on a fresh device', () => {
    appendSession(makeSession());
    appendSession(makeSession({ servedArmId: 'noise-up' }));
    savePreset(makePreset());
    const bundle = buildExportBundle();

    // Fresh device.
    globalThis.localStorage = fakeLocalStorage();
    const summary = importBundle(bundle);
    expect(summary).toEqual({ sessionsAdded: 2, presetsAdded: 1, programsAdded: 0 });
    expect(loadSessions()).toHaveLength(2);
    expect(loadPresets()).toHaveLength(1);

    const rebuilt = loadPersonalization(CANDIDATE_SET_VERSION);
    expect(rebuilt.arms.focus![PRIOR_ARM_ID].n).toBe(1);
    expect(rebuilt.arms.focus!['noise-up'].n).toBe(1);
  });

  it('restores programs on a fresh device and imports legacy bundles without them', () => {
    const program = defaultProgram('focus', 0.5);
    saveProgram(program);
    const bundle = buildExportBundle();

    globalThis.localStorage = fakeLocalStorage();
    expect(importBundle(bundle).programsAdded).toBe(1);
    expect(loadPrograms()).toEqual([program]);

    // A pre-programs bundle (no `programs` key) leaves local programs alone.
    const legacy = { ...bundle };
    delete legacy.programs;
    expect(importBundle(legacy).programsAdded).toBe(0);
    expect(loadPrograms()).toEqual([program]);
  });

  it('re-importing the same bundle is a no-op', () => {
    appendSession(makeSession());
    savePreset(makePreset());
    const bundle = buildExportBundle();

    const first = importBundle(bundle);
    expect(first).toEqual({ sessionsAdded: 0, presetsAdded: 0, programsAdded: 0 });
    const again = importBundle(bundle);
    expect(again).toEqual({ sessionsAdded: 0, presetsAdded: 0, programsAdded: 0 });
    expect(loadSessions()).toHaveLength(1);
    expect(loadPresets()).toHaveLength(1);
    expect(loadPersonalization(CANDIDATE_SET_VERSION).arms.focus![PRIOR_ARM_ID].n).toBe(1);
  });

  it('merges without wiping local data and keeps sessions newest-first', () => {
    const localSession = makeSession({ startedAt: '2026-08-22T10:00:00.000Z' });
    appendSession(localSession);
    const foreignSession = makeSession({ startedAt: '2026-08-21T10:00:00.000Z' });
    const bundle = {
      ...buildExportBundle(),
      sessions: [foreignSession],
      presets: [makePreset()],
    };

    importBundle(bundle);
    expect(loadSessions().map((s) => s.id)).toEqual([
      localSession.id,
      foreignSession.id,
    ]);
  });

  it('keeps a non-null local disclaimer acknowledgement', () => {
    saveSettings({
      ...defaultSettings,
      disclaimerAcknowledgedAt: '2026-08-01T00:00:00.000Z',
    });
    const bundle = buildExportBundle();
    bundle.settings = { ...defaultSettings, monoMode: true }; // foreign, unacknowledged

    importBundle(bundle);
    const settings = loadSettings();
    expect(settings.disclaimerAcknowledgedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(settings.monoMode).toBe(true);
  });
});
