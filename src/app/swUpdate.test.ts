import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetReloadGate, setReloadBusy } from './reloadGate';
import {
  applyUpdate,
  dismissUpdate,
  getUpdateReady,
  getUpdateStatus,
  markUpdateReady,
  resetSwUpdate,
  setUpdateHandler,
  subscribeUpdateReady,
} from './swUpdate';

beforeEach(() => {
  resetSwUpdate();
  resetReloadGate();
});

describe('service-worker update store', () => {
  it('announces a ready update without applying it', () => {
    const apply = vi.fn();
    setUpdateHandler(apply);
    const listener = vi.fn();
    subscribeUpdateReady(listener);
    expect(getUpdateStatus()).toBe('idle');
    markUpdateReady();
    expect(getUpdateStatus()).toBe('ready');
    expect(getUpdateReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies immediately when the app is idle', () => {
    const apply = vi.fn();
    setUpdateHandler(apply);
    markUpdateReady();
    applyUpdate();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(getUpdateStatus()).toBe('idle');
  });

  it('defers while a session or export is busy, then applies once idle', () => {
    const apply = vi.fn();
    setUpdateHandler(apply);
    markUpdateReady();
    setReloadBusy(true);
    applyUpdate();
    expect(apply).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toBe('scheduled');
    markUpdateReady(); // a second announcement must not un-schedule it
    expect(getUpdateStatus()).toBe('scheduled');
    setReloadBusy(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(getUpdateStatus()).toBe('idle');
  });

  it('Later hides the toast until the next announcement', () => {
    setUpdateHandler(vi.fn());
    markUpdateReady();
    dismissUpdate();
    expect(getUpdateStatus()).toBe('dismissed');
    expect(getUpdateReady()).toBe(true); // still known to be waiting
    markUpdateReady();
    expect(getUpdateStatus()).toBe('ready');
  });

  it('does nothing without a handler', () => {
    markUpdateReady();
    applyUpdate();
    expect(getUpdateStatus()).toBe('ready');
  });
});
