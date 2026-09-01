import type { SessionRecord } from './types';

/**
 * IndexedDB primitives for session records — the only IndexedDB code in the
 * app, kept to a deliberately narrow surface (open / getAll / put / delete /
 * clear / count) so the test fake in src/test/fakeIndexedDb.ts can mirror it
 * exactly. Policy (cache, migration, caps, fallback) lives in storage.ts.
 */
export const SESSION_DB_NAME = 'resonance';
export const SESSION_DB_VERSION = 1;
export const SESSION_STORE = 'sessions';

function settle<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Open (creating the store on first use). Resolves null wherever IndexedDB is
 * missing, blocked, or refuses to open (some private-browsing modes) — the
 * caller then keeps using localStorage.
 */
export function openSessionDb(
  factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB,
): Promise<IDBDatabase | null> {
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(SESSION_DB_NAME, SESSION_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function getAllSessions(db: IDBDatabase): Promise<SessionRecord[]> {
  const tx = db.transaction(SESSION_STORE, 'readonly');
  const all = await settle(tx.objectStore(SESSION_STORE).getAll());
  return all as SessionRecord[];
}

export async function countSessions(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(SESSION_STORE, 'readonly');
  return settle(tx.objectStore(SESSION_STORE).count());
}

/** Upsert in one transaction — all or nothing. */
export async function putSessions(db: IDBDatabase, records: readonly SessionRecord[]): Promise<void> {
  if (records.length === 0) return;
  const tx = db.transaction(SESSION_STORE, 'readwrite');
  const store = tx.objectStore(SESSION_STORE);
  for (const record of records) store.put(record);
  await complete(tx);
}

export async function deleteSessions(db: IDBDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction(SESSION_STORE, 'readwrite');
  const store = tx.objectStore(SESSION_STORE);
  for (const id of ids) store.delete(id);
  await complete(tx);
}

/** Clear and refill in one transaction (import / wholesale replace). */
export async function replaceAllSessions(
  db: IDBDatabase,
  records: readonly SessionRecord[],
): Promise<void> {
  const tx = db.transaction(SESSION_STORE, 'readwrite');
  const store = tx.objectStore(SESSION_STORE);
  store.clear();
  for (const record of records) store.put(record);
  await complete(tx);
}
