import { MAX_END_AT_MINUTES, MIN_CUSTOM_MINUTES } from './durationLimits';

/**
 * "End at HH:MM" durations: minutes from `now` until the next occurrence of
 * a wall-clock time. A target that is already past (or too close to start
 * a session) means tomorrow. Clamped to what a session can run.
 */
export function minutesUntil(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  const target = new Date(now);
  target.setHours(hours, mins, 0, 0);
  let minutes = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (minutes < MIN_CUSTOM_MINUTES) minutes += 24 * 60;
  return Math.min(MAX_END_AT_MINUTES, Math.max(MIN_CUSTOM_MINUTES, minutes));
}

/** "7 h 40 min" / "45 min" for readouts. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
