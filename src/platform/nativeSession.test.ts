import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_MS,
  NativeSessionBackend,
  resetNotificationAsk,
  type NativeFocusState,
  type NativeSessionAction,
  type ResonanceSessionPlugin,
} from './nativeSession';

function fakePlugin() {
  const listeners: Record<string, ((e: never) => void)[]> = {};
  const remove = vi.fn();
  const plugin = {
    start: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    requestNotificationPermission: vi.fn().mockResolvedValue({ granted: true }),
    addListener: vi.fn((event: string, cb: (e: never) => void) => {
      (listeners[event] ??= []).push(cb);
      return Promise.resolve({ remove });
    }),
  };
  return {
    plugin: plugin as unknown as ResonanceSessionPlugin,
    mocks: plugin,
    remove,
    action: (action: NativeSessionAction) =>
      listeners.action?.forEach((cb) => cb({ action } as never)),
    focus: (state: NativeFocusState) => listeners.focus?.forEach((cb) => cb({ state } as never)),
  };
}

function handlers() {
  return {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onInterrupt: vi.fn(),
    onInterruptEnd: vi.fn(),
  };
}

const ART = 'data:image/png;base64,AAAA';

describe('NativeSessionBackend', () => {
  let now = 0;
  let fake: ReturnType<typeof fakePlugin>;
  let backend: NativeSessionBackend;

  beforeEach(() => {
    now = 1_000_000;
    resetNotificationAsk();
    fake = fakePlugin();
    backend = new NativeSessionBackend(fake.plugin, () => now);
  });

  it('starts the service on the first live state, with the metadata so far', () => {
    backend.setMetadata({ title: 'Focus · 30 min', artwork: [{ src: ART }] });
    backend.setPosition(1800, 0);
    expect(fake.mocks.start).not.toHaveBeenCalled();
    backend.setPlaybackState('playing');
    expect(fake.mocks.start).toHaveBeenCalledWith({
      title: 'Focus · 30 min',
      subtitle: 'Resonance',
      artwork: ART,
      playing: true,
      durationSec: 1800,
    });
    expect(fake.mocks.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('asks for the notification permission once per app run', () => {
    backend.setPlaybackState('playing');
    backend.setPlaybackState('none');
    const second = new NativeSessionBackend(fake.plugin, () => now);
    second.setPlaybackState('playing');
    expect(fake.mocks.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('sends only artwork the service can decode (data: URLs)', () => {
    backend.setMetadata({ title: 'Sleep', artwork: [{ src: '/pwa-512x512.png' }] });
    backend.setPlaybackState('playing');
    expect(fake.mocks.start.mock.calls[0][0]).not.toHaveProperty('artwork');
  });

  it('updates play/pause only when it changes, and stops on none', () => {
    backend.setPlaybackState('playing');
    backend.setPlaybackState('playing');
    expect(fake.mocks.update).not.toHaveBeenCalled();
    backend.setPlaybackState('paused');
    expect(fake.mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));
    backend.setPlaybackState('none');
    expect(fake.mocks.stop).toHaveBeenCalledTimes(1);
    backend.setPlaybackState('none');
    expect(fake.mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('a metadata change mid-session (routine leg, +15 min) updates in place', () => {
    backend.setPlaybackState('playing');
    backend.setMetadata({ title: 'Sleep · 45 min', subtitle: 'Resonance · Wind-down 2/2' });
    expect(fake.mocks.update).toHaveBeenLastCalledWith({
      title: 'Sleep · 45 min',
      subtitle: 'Resonance · Wind-down 2/2',
    });
    expect(fake.mocks.start).toHaveBeenCalledTimes(1);
  });

  it('position: quiet while it tracks, corrects drift, heartbeats every minute', () => {
    backend.setPosition(600, 0);
    backend.setPlaybackState('playing');
    for (let s = 1; s <= 30; s++) {
      now += 1000;
      backend.setPosition(600, s);
    }
    expect(fake.mocks.update).not.toHaveBeenCalled();

    now += 1000;
    backend.setPosition(600, 40); // jumped 9 s ahead of the extrapolation
    expect(fake.mocks.update).toHaveBeenLastCalledWith({ durationSec: 600, positionSec: 40 });

    fake.mocks.update.mockClear();
    let position = 40;
    for (let t = 0; t < HEARTBEAT_MS; t += 1000) {
      now += 1000;
      backend.setPosition(600, ++position);
    }
    expect(fake.mocks.update).toHaveBeenCalledTimes(1);
  });

  it('position: a paused session is expected to stand still', () => {
    backend.setPosition(600, 100);
    backend.setPlaybackState('paused');
    now += 10_000;
    backend.setPosition(600, 100);
    expect(fake.mocks.update).not.toHaveBeenCalled();
  });

  it('a duration change (+15 min) is sent at once', () => {
    backend.setPosition(600, 0);
    backend.setPlaybackState('playing');
    now += 1000;
    backend.setPosition(1500, 1);
    expect(fake.mocks.update).toHaveBeenLastCalledWith({ durationSec: 1500, positionSec: 1 });
  });

  it('routes transport actions to the handlers', () => {
    const h = handlers();
    backend.setHandlers(h);
    fake.action('pause');
    fake.action('resume');
    fake.action('stop');
    expect(h.onPause).toHaveBeenCalledTimes(1);
    expect(h.onResume).toHaveBeenCalledTimes(1);
    expect(h.onStop).toHaveBeenCalledTimes(1);
  });

  it('focus: a transient loss interrupts and its end resumes', () => {
    const h = handlers();
    backend.setHandlers(h);
    fake.focus('transient');
    expect(h.onInterrupt).toHaveBeenCalledTimes(1);
    fake.focus('gained');
    expect(h.onInterruptEnd).toHaveBeenCalledTimes(1);
  });

  it('focus: a permanent loss interrupts and never auto-resumes', () => {
    const h = handlers();
    backend.setHandlers(h);
    fake.focus('lost');
    fake.focus('gained');
    expect(h.onInterrupt).toHaveBeenCalledTimes(1);
    expect(h.onInterruptEnd).not.toHaveBeenCalled();
  });

  it('registers listeners once and removes them on clear', async () => {
    backend.setHandlers(handlers());
    backend.setHandlers(handlers());
    expect(fake.mocks.addListener).toHaveBeenCalledTimes(2); // action + focus
    backend.setPlaybackState('playing');
    backend.clear();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.remove).toHaveBeenCalledTimes(2);
    expect(fake.mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('a failing plugin call never throws into the session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fake.mocks.start.mockRejectedValueOnce(new Error('not allowed'));
    expect(() => backend.setPlaybackState('playing')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
