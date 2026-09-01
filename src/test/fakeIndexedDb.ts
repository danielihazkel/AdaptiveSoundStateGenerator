/**
 * A minimal in-memory IndexedDB for tests, mirroring exactly the surface
 * storage/sessionDb.ts uses: open (with upgrade) → transaction → objectStore
 * → getAll / put / delete / clear / count, with success/complete events fired
 * asynchronously like the real thing. Anything else throws, so a new IDB
 * call in production code shows up here first.
 */
type Listener = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: Listener = null;
  onerror: Listener = null;
  private readonly done: Array<(ok: boolean) => void> = [];
  constructor(run: () => T) {
    // Settles on a microtask — after the caller attached its handlers.
    queueMicrotask(() => {
      let ok = true;
      try {
        this.result = run();
      } catch (err) {
        this.error = err as Error;
        ok = false;
      }
      // Transaction bookkeeping first, then the user's handler (like the
      // real event order: the request settles, then the transaction can complete).
      for (const cb of this.done) cb(ok);
      if (ok) this.onsuccess?.();
      else this.onerror?.();
    });
  }
  /** Internal: lets the owning transaction count settled requests. */
  whenDone(cb: (ok: boolean) => void): void {
    this.done.push(cb);
  }
}

class FakeStore {
  constructor(
    private readonly rows: Map<string, unknown>,
    private readonly keyPath: string,
    private readonly tx: FakeTransaction,
  ) {}
  private guardWrite(): void {
    if (this.tx.mode !== 'readwrite') throw new Error('read-only transaction');
  }
  getAll(): FakeRequest<unknown[]> {
    return this.tx.track(new FakeRequest(() => [...this.rows.values()].map((r) => structuredClone(r))));
  }
  count(): FakeRequest<number> {
    return this.tx.track(new FakeRequest(() => this.rows.size));
  }
  put(value: unknown): FakeRequest<string> {
    this.guardWrite();
    return this.tx.track(
      new FakeRequest(() => {
        const key = (value as Record<string, unknown>)[this.keyPath];
        if (typeof key !== 'string') throw new Error('missing key');
        this.rows.set(key, structuredClone(value));
        return key;
      }),
    );
  }
  delete(key: string): FakeRequest<undefined> {
    this.guardWrite();
    return this.tx.track(
      new FakeRequest(() => {
        this.rows.delete(key);
        return undefined;
      }),
    );
  }
  clear(): FakeRequest<undefined> {
    this.guardWrite();
    return this.tx.track(
      new FakeRequest(() => {
        this.rows.clear();
        return undefined;
      }),
    );
  }
}

class FakeTransaction {
  oncomplete: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  error: Error | null = null;
  private pending = 0;
  private failed = false;
  constructor(
    private readonly db: FakeDatabase,
    readonly mode: 'readonly' | 'readwrite',
  ) {
    // Completes once every request issued against it has settled.
    setTimeout(() => this.finish(), 0);
  }
  objectStore(name: string): FakeStore {
    const rows = this.db.stores.get(name);
    if (!rows) throw new Error(`no store ${name}`);
    return new FakeStore(rows, this.db.keyPaths.get(name)!, this);
  }
  track<T>(req: FakeRequest<T>): FakeRequest<T> {
    this.pending += 1;
    req.whenDone((ok) => {
      this.pending -= 1;
      if (!ok) {
        this.failed = true;
        this.error = req.error;
      }
    });
    return req;
  }
  private finish(): void {
    if (this.pending > 0) {
      setTimeout(() => this.finish(), 0);
      return;
    }
    if (this.failed) this.onabort?.();
    else this.oncomplete?.();
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly keyPaths = new Map<string, string>();
  closed = false;
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  createObjectStore(name: string, opts: { keyPath: string }): void {
    this.stores.set(name, new Map());
    this.keyPaths.set(name, opts.keyPath);
  }
  transaction(name: string, mode: 'readonly' | 'readwrite' = 'readonly'): FakeTransaction {
    if (this.closed) throw new Error('database closed');
    if (!this.stores.has(name)) throw new Error(`no store ${name}`);
    return new FakeTransaction(this, mode);
  }
  close(): void {
    this.closed = true;
  }
}

class FakeOpenRequest {
  result!: FakeDatabase;
  error: Error | null = null;
  onupgradeneeded: Listener = null;
  onsuccess: Listener = null;
  onerror: Listener = null;
  onblocked: Listener = null;
}

export interface FakeIndexedDb {
  factory: IDBFactory;
  /** Rows of a store by key, for assertions. */
  rows: (store: string) => Map<string, unknown>;
  /** Flip to make every subsequent open() fail (private-mode style). */
  failOpen: boolean;
  opens: number;
}

export function fakeIndexedDb(): FakeIndexedDb {
  const dbs = new Map<string, FakeDatabase>();
  const state: FakeIndexedDb = {
    failOpen: false,
    opens: 0,
    rows: (store) => {
      for (const db of dbs.values()) {
        const rows = db.stores.get(store);
        if (rows) return rows;
      }
      return new Map();
    },
    factory: {
      open: (name: string) => {
        state.opens += 1;
        const req = new FakeOpenRequest();
        queueMicrotask(() => {
          if (state.failOpen) {
            req.error = new Error('open refused');
            req.onerror?.();
            return;
          }
          let db = dbs.get(name);
          const fresh = !db;
          if (!db) {
            db = new FakeDatabase();
            dbs.set(name, db);
          }
          db.closed = false;
          req.result = db;
          if (fresh) req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory,
  };
  return state;
}

/** Let every queued request/transaction in the fake settle. */
export async function flushIndexedDb(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}
