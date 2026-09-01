import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireSessionLock, SESSION_LOCK_NAME, subscribeTabPresence, TAB_CHANNEL_NAME } from './tabGuard';

/** Minimal in-process BroadcastChannel: same-name channels share a bus. */
class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.add(this);
  }
  postMessage(data: unknown): void {
    for (const other of FakeBroadcastChannel.channels) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data });
    }
  }
  close(): void {
    FakeBroadcastChannel.channels.delete(this);
  }
}

const g = globalThis as { BroadcastChannel?: unknown };
const original = g.BroadcastChannel;

describe('subscribeTabPresence', () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels.clear();
    g.BroadcastChannel = FakeBroadcastChannel;
  });
  afterEach(() => {
    g.BroadcastChannel = original;
  });

  it('is silent for a single tab', () => {
    let hits = 0;
    const unsub = subscribeTabPresence(() => hits++);
    expect(hits).toBe(0);
    unsub();
    expect(FakeBroadcastChannel.channels.size).toBe(0);
  });

  it('tells both tabs when a second one opens', () => {
    let first = 0;
    let second = 0;
    const unsubA = subscribeTabPresence(() => first++);
    const unsubB = subscribeTabPresence(() => second++);
    expect(first).toBe(1); // heard the newcomer's hello
    expect(second).toBe(1); // got the reply
    unsubA();
    unsubB();
  });

  it('uses the shared channel name', () => {
    const unsub = subscribeTabPresence(() => {});
    expect([...FakeBroadcastChannel.channels][0].name).toBe(TAB_CHANNEL_NAME);
    unsub();
  });

  it('is a no-op without BroadcastChannel', () => {
    delete g.BroadcastChannel;
    let hits = 0;
    const unsub = subscribeTabPresence(() => hits++);
    unsub();
    expect(hits).toBe(0);
  });
});

/** Minimal Web Locks stand-in: one holder per name, ifAvailable semantics only. */
function fakeLocks() {
  const held = new Map<string, Promise<unknown>>();
  const manager = {
    request: (name: string, _opts: unknown, cb: (lock: { name: string } | null) => Promise<unknown>) => {
      if (held.has(name)) return cb(null);
      const running = cb({ name }).finally(() => held.delete(name));
      held.set(name, running);
      return running;
    },
  } as unknown as LockManager;
  return { manager, isHeld: (name: string) => held.has(name) };
}

describe('acquireSessionLock', () => {
  it('always grants without Web Locks', async () => {
    const release = await acquireSessionLock(undefined);
    expect(release).not.toBeNull();
    release!();
  });

  it('grants once, refuses a second holder until released', async () => {
    const { manager, isHeld } = fakeLocks();
    const first = await acquireSessionLock(manager);
    expect(first).not.toBeNull();
    expect(isHeld(SESSION_LOCK_NAME)).toBe(true);
    expect(await acquireSessionLock(manager)).toBeNull();
    first!();
    await new Promise((r) => setTimeout(r, 0));
    expect(isHeld(SESSION_LOCK_NAME)).toBe(false);
    const again = await acquireSessionLock(manager);
    expect(again).not.toBeNull();
    again!();
  });

  it('grants when the lock manager itself fails', async () => {
    const broken = { request: () => Promise.reject(new Error('no locks')) } as unknown as LockManager;
    expect(await acquireSessionLock(broken)).not.toBeNull();
  });
});
