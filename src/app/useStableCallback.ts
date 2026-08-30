import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback with a stable identity that always invokes the latest render's
 * closure. The ref is synced in a layout effect (never during render), so it
 * is safe under StrictMode / concurrent rendering, and it is committed before
 * any event handler, timer, or controller callback can fire.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
