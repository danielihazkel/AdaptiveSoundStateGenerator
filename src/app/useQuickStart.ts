import { useEffect } from 'react';
import { STATES, type MentalState } from '../audio/states';
import { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES } from '../session/durationLimits';
import { loadSessions } from '../storage/storage';
import type { SetupSelection } from './useSetupSelection';

export type QuickStart =
  | { kind: 'state'; state: MentalState; minutes?: number; intensity?: number }
  | { kind: 'last' };

/**
 * `?start=focus&minutes=25&depth=0.6` or `?start=last` — home-screen
 * shortcuts (manifest) and bookmarks. Unknown or malformed values are ignored.
 */
export function parseQuickStart(search: string): QuickStart | null {
  const params = new URLSearchParams(search);
  const start = params.get('start');
  if (!start) return null;
  if (start === 'last') return { kind: 'last' };
  if (!Object.prototype.hasOwnProperty.call(STATES, start)) return null;
  const result: QuickStart = { kind: 'state', state: start as MentalState };
  const minutes = Number(params.get('minutes'));
  if (params.has('minutes') && Number.isFinite(minutes)) {
    result.minutes = Math.min(MAX_CUSTOM_MINUTES, Math.max(MIN_CUSTOM_MINUTES, Math.round(minutes)));
  }
  const depth = Number(params.get('depth'));
  if (params.has('depth') && Number.isFinite(depth)) {
    result.intensity = Math.min(1, Math.max(0, depth));
  }
  return result;
}

/**
 * Applies a quick-start URL to the setup selection on first load and strips
 * it from the address bar. It pre-fills only — audio needs a tap, so the
 * user still presses Begin.
 */
export function useQuickStart(selection: SetupSelection, ready = true): void {
  useEffect(() => {
    // "Play last" needs the session store; the URL is consumed once it's up.
    if (!ready) return;
    const quick = parseQuickStart(window.location.search);
    if (!quick) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of ['start', 'minutes', 'depth']) params.delete(key);
    const rest = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash,
    );
    if (quick.kind === 'last') {
      const last = loadSessions().find((s) => !s.recovered);
      if (last) selection.replayFrom(last);
      return;
    }
    selection.selectState(quick.state);
    if (quick.minutes !== undefined) {
      selection.setMinutes(quick.minutes);
      selection.setEndAt(null);
    }
    if (quick.intensity !== undefined) selection.setIntensity(quick.intensity);
    // Runs once the store is ready; the URL is consumed exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
