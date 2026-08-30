import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestReload, resetReloadGate, setReloadBusy } from './reloadGate';

describe('reloadGate', () => {
  beforeEach(resetReloadGate);

  it('reloads immediately when idle', () => {
    const reload = vi.fn();
    requestReload(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('defers a reload while busy and runs it once idle', () => {
    const reload = vi.fn();
    setReloadBusy(true);
    requestReload(reload);
    expect(reload).not.toHaveBeenCalled();
    setReloadBusy(false);
    expect(reload).toHaveBeenCalledTimes(1);
    setReloadBusy(false); // no double run
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps only the latest deferred reload', () => {
    const first = vi.fn();
    const second = vi.fn();
    setReloadBusy(true);
    requestReload(first);
    requestReload(second);
    setReloadBusy(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
