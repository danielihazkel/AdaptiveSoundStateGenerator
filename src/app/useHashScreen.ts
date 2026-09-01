import { useEffect, useRef, useState } from 'react';
import { hashForScreen, LOCKED, NAVIGABLE, screenForHash } from './router';
import type { Screen } from './types';
import { useStableCallback } from './useStableCallback';

type Entry = { idx: number } | null;

/**
 * Owns the current screen and mirrors it into `location.hash` so the browser
 * Back button works.
 *
 * Model: setup is always history index 0. Opening a navigable sub-screen
 * pushes one entry; returning to setup pops back to index 0 (so Back never
 * has to walk through a trail of setup↔history flips). Session and feedback
 * change the screen without touching history, and while one of them is
 * showing every popstate is reversed — Back cannot interrupt a session.
 *
 * `transition(from, to)` runs on every screen change, whether triggered by
 * the app or by the browser; returning false vetoes it (a veto on a browser
 * navigation reverses that navigation).
 */
export function useHashScreen(opts: {
  initial: () => Screen;
  transition: (from: Screen, to: Screen) => boolean;
}) {
  const [screen, setScreen] = useState<Screen>(opts.initial);
  const screenRef = useRef(screen);
  const idxRef = useRef(0);
  /** Index a programmatic `history.go` is heading for; its popstate is a sync, not a navigation. */
  const expectRef = useRef<number | null>(null);
  const transition = useStableCallback(opts.transition);

  const commit = (next: Screen) => {
    screenRef.current = next;
    setScreen(next);
  };

  // Stamp the entry we loaded on so later popstates can tell direction.
  // The initializer already read the hash; rewriting it here also normalises
  // `?lab` into `#lab`. Runs before the share/quick-start hooks only because
  // it is declared first, and those preserve or intentionally clear the hash.
  useEffect(() => {
    window.history.replaceState({ idx: 0 }, '', currentUrl(hashForScreen(screenRef.current)));
  }, []);

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const state = e.state as Entry;
      let idx = typeof state?.idx === 'number' ? state.idx : idxRef.current + 1;
      if (!state) {
        // Typed-in hash: a fresh forward entry the app didn't create.
        window.history.replaceState({ idx }, '', window.location.href);
      }
      if (expectRef.current !== null) {
        if (idx === expectRef.current) expectRef.current = null;
        idxRef.current = idx;
        return;
      }
      const from = screenRef.current;
      const to = screenForHash(window.location.hash) ?? 'setup';
      const allowed = !LOCKED.has(from) && (from === to || transition(from, to));
      if (!allowed) {
        expectRef.current = idxRef.current;
        window.history.go(idxRef.current - idx);
        return;
      }
      if (to === 'setup') idx = 0;
      idxRef.current = idx;
      if (from !== to) commit(to);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [transition]);

  const navigate = (to: Screen) => {
    const from = screenRef.current;
    if (from === to) return;
    if (!transition(from, to)) return;
    if (NAVIGABLE.has(to)) {
      idxRef.current += 1;
      window.history.pushState({ idx: idxRef.current }, '', currentUrl(hashForScreen(to)));
      commit(to);
      return;
    }
    commit(to);
    if (idxRef.current > 0) {
      const back = idxRef.current;
      idxRef.current = 0;
      expectRef.current = 0;
      window.history.go(-back);
    } else if (window.location.hash !== hashForScreen(to)) {
      window.history.replaceState({ idx: 0 }, '', currentUrl(hashForScreen(to)));
    }
  };

  return { screen, navigate };
}

function currentUrl(hash: string): string {
  return window.location.pathname + window.location.search + hash;
}
