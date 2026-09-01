// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { SESSION_STORE } from '../storage/sessionDb';
import { appendSession, resetSessionStoreForTests, sessionStoreBackend } from '../storage/storage';
import type { SessionRecord } from '../storage/types';
import { fakeIndexedDb, flushIndexedDb } from '../test/fakeIndexedDb';
import { useStoredData } from './useStoredData';

const g = globalThis as { indexedDB?: IDBFactory };

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: Math.random().toString(36).slice(2),
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
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetSessionStoreForTests();
});

afterEach(() => {
  delete g.indexedDB;
  resetSessionStoreForTests();
});

describe('useStoredData session store startup', () => {
  it('reports sessionsLoaded once the store is up, migrating localStorage into IndexedDB', async () => {
    const fake = fakeIndexedDb();
    g.indexedDB = fake.factory;
    const stored = session();
    appendSession(stored); // lands in localStorage — nothing is initialised yet
    const { result } = renderHook(() => useStoredData('setup'));
    expect(result.current.sessionsLoaded).toBe(false);
    await waitFor(() => expect(result.current.sessionsLoaded).toBe(true));
    expect(sessionStoreBackend()).toBe('indexeddb');
    expect(result.current.historyAvailable).toBe(true);
    expect(result.current.lastSession?.id).toBe(stored.id);
    await flushIndexedDb();
    expect(fake.rows(SESSION_STORE).has(stored.id)).toBe(true);
    expect(localStorage.getItem('resonance.v1.sessions')).toBeNull();
  });

  it('falls back to localStorage without IndexedDB and still loads', async () => {
    const stored = session();
    appendSession(stored);
    const { result } = renderHook(() => useStoredData('setup'));
    await waitFor(() => expect(result.current.sessionsLoaded).toBe(true));
    expect(sessionStoreBackend()).toBe('localStorage');
    expect(result.current.lastSession?.id).toBe(stored.id);
    expect(localStorage.getItem('resonance.v1.sessions')).not.toBeNull();
  });

  it('recovers an in-progress checkpoint into history after the store is ready', async () => {
    localStorage.setItem(
      'resonance.v1.inProgress',
      JSON.stringify({
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        state: 'relax',
        intensity: 0.5,
        plannedDurationSec: 1800,
        profile: STATES.relax.buildProfile(0.5),
        monoMode: false,
        elapsedSec: 600,
        updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    );
    const { result } = renderHook(() => useStoredData('setup'));
    await waitFor(() => expect(result.current.sessionsLoaded).toBe(true));
    await waitFor(() => expect(result.current.recoveredSession).not.toBeNull());
    expect(result.current.recoveredSession).toMatchObject({ state: 'relax', recovered: true });
    expect(localStorage.getItem('resonance.v1.inProgress')).toBeNull();
    expect(result.current.historyAvailable).toBe(true);
  });
});
