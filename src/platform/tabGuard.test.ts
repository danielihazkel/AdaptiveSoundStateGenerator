import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscribeTabPresence, TAB_CHANNEL_NAME } from './tabGuard';

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
