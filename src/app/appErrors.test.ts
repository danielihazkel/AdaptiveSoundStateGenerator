import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAppError,
  getAppError,
  installGlobalErrorHandlers,
  isChunkLoadError,
  reportAppError,
  resetAppErrors,
  subscribeAppErrors,
} from './appErrors';

beforeEach(() => resetAppErrors());

describe('isChunkLoadError', () => {
  it('recognises the ways browsers phrase a failed dynamic import', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /x.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError('Loading chunk 3 failed')).toBe(true);
  });

  it('leaves ordinary errors alone', () => {
    expect(isChunkLoadError(new Error('AudioContext was not allowed to start'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
  });
});

describe('app error store', () => {
  it('starts empty and notifies subscribers on report and clear', () => {
    expect(getAppError()).toBeNull();
    const listener = vi.fn();
    subscribeAppErrors(listener);
    reportAppError(new Error('boom'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAppError()).toMatchObject({ message: 'boom', chunkLoad: false });
    clearAppError();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getAppError()).toBeNull();
    clearAppError(); // idempotent — no extra notification
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('truncates long messages and copes with non-Error rejections', () => {
    reportAppError('x'.repeat(500));
    expect(getAppError()!.message.length).toBeLessThanOrEqual(120);
    expect(getAppError()!.message.endsWith('…')).toBe(true);
    reportAppError({ message: 'object-shaped' });
    expect(getAppError()!.message).toBe('object-shaped');
    reportAppError(undefined);
    expect(getAppError()!.message).toBe('undefined');
    reportAppError('   ');
    expect(getAppError()!.message).toBe('Unknown error');
  });

  it('flags chunk-load failures', () => {
    reportAppError(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'));
    expect(getAppError()!.chunkLoad).toBe(true);
  });

  it('unsubscribes', () => {
    const listener = vi.fn();
    const off = subscribeAppErrors(listener);
    off();
    reportAppError('x');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('installGlobalErrorHandlers', () => {
  it('routes unhandled rejections and errors into the store, and uninstalls', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const target = {
      addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Window;
    const uninstall = installGlobalErrorHandlers(target);
    handlers.get('unhandledrejection')!({ reason: new Error('rejected') });
    expect(getAppError()!.message).toBe('rejected');
    handlers.get('error')!({ error: null, message: 'Script error.' });
    expect(getAppError()!.message).toBe('Script error.');
    uninstall();
    expect(handlers.size).toBe(0);
  });
});
