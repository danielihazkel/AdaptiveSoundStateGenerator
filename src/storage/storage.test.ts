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
  onStorageChanged,
  withStorageLock,
  QUARANTINE_SUFFIX,
  savePersonalization,
  savePreset,
  saveProgram,
  saveSettings,
} from './storage';
import { defaultSettings, modeFor, SCHEMA_VERSION, type Preset, type SessionRecord } from './types';
import { fakeIndexedDb, flushIndexedDb } from '../test/fakeIndexedDb';
import { SESSION_STORE } from './sessionDb';
import {
  initSessionStore,
  MAX_SESSION_RECORDS_DB,
  overwriteSessions,
  resetSessionStoreForTests,
  sessionStoreBackend,
} from './storage';

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

  it('attachFeedback stores the optional PRD §9 extras only when given', () => {
    const a = makeSession();
    appendSession(a);
    attachFeedback(a.id, { rating: 3, distraction: 3 });
    expect(loadSessions()[0].feedback).toMatchObject({ rating: 3, distraction: 3 });
    expect(loadSessions()[0].feedback).not.toHaveProperty('useAgain');
    attachFeedback(a.id, { rating: 5, useAgain: true });
    expect(loadSessions()[0].feedback).toMatchObject({ rating: 5, useAgain: true });
    expect(loadSessions()[0].feedback).not.toHaveProperty('distraction');
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

describe('cross-tab hooks', () => {
  const g = globalThis as { window?: unknown };

  it('onStorageChanged is a no-op without a window and filters to our keys', () => {
    const originalWindow = g.window;
    delete g.window;
    expect(() => onStorageChanged(() => {})()).not.toThrow();

    const handlers = new Map<string, (e: unknown) => void>();
    g.window = {
      addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type),
    };
    const seen: string[] = [];
    const off = onStorageChanged((key) => seen.push(key));
    const fire = handlers.get('storage')!;
    fire({ key: 'resonance.v1.sessions' });
    fire({ key: 'other-app.thing' });
    fire({ key: null });
    expect(seen).toEqual(['resonance.v1.sessions', '*']);
    off();
    expect(handlers.size).toBe(0);
    if (originalWindow === undefined) delete g.window;
    else g.window = originalWindow;
  });

  it('withStorageLock runs once: under the lock when available, synchronously otherwise', async () => {
    let runs = 0;
    withStorageLock(() => runs++, undefined);
    expect(runs).toBe(1);

    let inLock = 0;
    const locks = {
      request: async (_name: string, cb: () => void) => {
        inLock++;
        cb();
      },
    } as unknown as LockManager;
    withStorageLock(() => runs++, locks);
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(2);
    expect(inLock).toBe(1);

    const broken = { request: () => Promise.reject(new Error('nope')) } as unknown as LockManager;
    withStorageLock(() => runs++, broken);
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(3);
  });
});

describe('IndexedDB session store', () => {
  const SESSIONS_KEY = 'resonance.v1.sessions';

  afterEach(() => {
    resetSessionStoreForTests();
  });

  it('serves from localStorage until initialised, and when IndexedDB is unavailable', async () => {
    const a = makeSession();
    appendSession(a);
    expect(sessionStoreBackend()).toBeNull();
    expect(loadSessions().map((s) => s.id)).toEqual([a.id]);
    expect(await initSessionStore(undefined)).toBe('localStorage');
    expect(sessionStoreBackend()).toBe('localStorage');
    expect(loadSessions().map((s) => s.id)).toEqual([a.id]);
    expect(localStorage.getItem(SESSIONS_KEY)).not.toBeNull();
  });

  it('migrates localStorage records into IndexedDB once, verified, then retires the copy', async () => {
    const older = makeSession({ startedAt: '2026-08-01T10:00:00.000Z' });
    const newer = makeSession({ startedAt: '2026-08-02T10:00:00.000Z' });
    appendSession(older);
    appendSession(newer);
    const fake = fakeIndexedDb();
    expect(await initSessionStore(fake.factory)).toBe('indexeddb');
    expect(loadSessions().map((s) => s.id)).toEqual([newer.id, older.id]);
    expect(fake.rows(SESSION_STORE).size).toBe(2);
    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();
    expect(localStorage.getItem(SESSIONS_KEY + '.migratedAt')).not.toBeNull();
    // Idempotent: a second init shares the first attempt.
    expect(await initSessionStore(fake.factory)).toBe('indexeddb');
    expect(fake.opens).toBe(1);
  });

  it('writes through: append, feedback, skip, resolve and overwrite all reach IndexedDB', async () => {
    const fake = fakeIndexedDb();
    await initSessionStore(fake.factory);
    const a = makeSession();
    appendSession(a);
    expect(loadSessions()[0].id).toBe(a.id);
    await flushIndexedDb();
    expect(fake.rows(SESSION_STORE).has(a.id)).toBe(true);

    attachFeedback(a.id, { rating: 4, useAgain: true });
    markFeedbackSkipped(a.id);
    markBanditResolved(a.id);
    expect(loadSessions()[0]).toMatchObject({ feedback: { rating: 4, useAgain: true }, feedbackSkipped: true });
    expect(loadSessions()[0].banditResolvedAt).toBeTruthy();
    await flushIndexedDb();
    const stored = fake.rows(SESSION_STORE).get(a.id) as SessionRecord;
    expect(stored.feedback?.rating).toBe(4);
    expect(stored.feedbackSkipped).toBe(true);
    expect(stored.banditResolvedAt).toBeTruthy();
    // The cache hands out shared records: the original object was never mutated.
    expect(a.feedback).toBeUndefined();
    // localStorage stays retired.
    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();

    const b = makeSession({ startedAt: new Date(Date.now() + 60_000).toISOString() });
    overwriteSessions([a, b]);
    expect(loadSessions().map((s) => s.id)).toEqual([b.id, a.id]);
    await flushIndexedDb();
    expect([...fake.rows(SESSION_STORE).keys()].sort()).toEqual([a.id, b.id].sort());
  });

  it('caps the IndexedDB store, dropping the oldest records', async () => {
    const fake = fakeIndexedDb();
    await initSessionStore(fake.factory);
    for (let i = 0; i <= MAX_SESSION_RECORDS_DB; i += 1) {
      appendSession(makeSession({ id: 'r' + i, startedAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
    }
    const kept = loadSessions();
    expect(kept).toHaveLength(MAX_SESSION_RECORDS_DB);
    expect(kept[0].id).toBe('r' + MAX_SESSION_RECORDS_DB);
    expect(kept.some((s) => s.id === 'r0')).toBe(false);
    await flushIndexedDb();
    expect(fake.rows(SESSION_STORE).size).toBe(MAX_SESSION_RECORDS_DB);
  });

  it('keeps localStorage intact when the migration cannot be verified', async () => {
    appendSession(makeSession());
    const fake = fakeIndexedDb();
    // A store whose count() always reports empty: the post-migration check must fail.
    const factory = {
      open: (name: string) => {
        const req = fake.factory.open(name) as unknown as {
          onsuccess: (() => void) | null;
          result: { transaction: (n: string, m: string) => IDBTransaction };
        };
        let userSuccess: (() => void) | null = null;
        Object.defineProperty(req, 'onsuccess', {
          configurable: true,
          set: (fn: (() => void) | null) => {
            userSuccess = fn;
          },
          get: () => () => {
            const db = req.result;
            const realTransaction = db.transaction.bind(db);
            db.transaction = (n: string, m: string) => {
              const tx = realTransaction(n, m);
              const realObjectStore = tx.objectStore.bind(tx);
              tx.objectStore = (storeName: string) => {
                const store = realObjectStore(storeName);
                const realCount = store.count.bind(store);
                store.count = () => {
                  const r = realCount();
                  Object.defineProperty(r, 'result', { get: () => 0, configurable: true });
                  return r;
                };
                return store;
              };
              return tx;
            };
            userSuccess?.();
          },
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    expect(await initSessionStore(factory)).toBe('localStorage');
    expect(localStorage.getItem(SESSIONS_KEY)).not.toBeNull();
    expect(loadSessions()).toHaveLength(1);
  });
});
