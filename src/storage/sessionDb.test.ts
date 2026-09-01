import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { fakeIndexedDb, flushIndexedDb } from '../test/fakeIndexedDb';
import {
  countSessions,
  deleteSessions,
  getAllSessions,
  openSessionDb,
  putSessions,
  replaceAllSessions,
  SESSION_STORE,
} from './sessionDb';
import type { SessionRecord } from './types';

function record(id: string): SessionRecord {
  return {
    id,
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
  };
}

describe('sessionDb', () => {
  it('opens, creating the store, and round-trips records', async () => {
    const fake = fakeIndexedDb();
    const db = (await openSessionDb(fake.factory))!;
    expect(db).not.toBeNull();
    expect(await countSessions(db)).toBe(0);
    await putSessions(db, [record('a'), record('b')]);
    expect(await countSessions(db)).toBe(2);
    const all = await getAllSessions(db);
    expect(all.map((r) => r.id).sort()).toEqual(['a', 'b']);
    // put is an upsert
    await putSessions(db, [{ ...record('a'), completed: false }]);
    expect((await getAllSessions(db)).find((r) => r.id === 'a')?.completed).toBe(false);
    await deleteSessions(db, ['a']);
    expect(await countSessions(db)).toBe(1);
    await replaceAllSessions(db, [record('z')]);
    expect((await getAllSessions(db)).map((r) => r.id)).toEqual(['z']);
    expect(fake.rows(SESSION_STORE).size).toBe(1);
    await flushIndexedDb();
  });

  it('empty batches are no-ops', async () => {
    const fake = fakeIndexedDb();
    const db = (await openSessionDb(fake.factory))!;
    await putSessions(db, []);
    await deleteSessions(db, []);
    expect(await countSessions(db)).toBe(0);
  });

  it('resolves null without IndexedDB or when open is refused', async () => {
    expect(await openSessionDb(undefined)).toBeNull();
    const fake = fakeIndexedDb();
    fake.failOpen = true;
    expect(await openSessionDb(fake.factory)).toBeNull();
    const throwing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    expect(await openSessionDb(throwing)).toBeNull();
  });
});
