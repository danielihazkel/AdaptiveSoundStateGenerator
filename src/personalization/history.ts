import type { MentalState } from '../audio/states';
import type { SessionRecord } from '../storage/types';

export interface HistorySummary {
  total: number;
  /** Sessions started in the last 7 days. */
  thisWeek: number;
  /** Minutes actually listened in the last 7 days. */
  minutesThisWeek: number;
  /** Consecutive local calendar days with ≥1 session, ending today or yesterday. */
  currentStreakDays: number;
  byState: Partial<Record<MentalState, number>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day as a stable key, independent of time of day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function summarizeHistory(sessions: SessionRecord[], now: Date): HistorySummary {
  const weekStart = now.getTime() - 7 * DAY_MS;
  let thisWeek = 0;
  let secondsThisWeek = 0;
  const byState: Partial<Record<MentalState, number>> = {};
  const days = new Set<string>();
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (Number.isNaN(t)) continue;
    byState[s.state] = (byState[s.state] ?? 0) + 1;
    days.add(dayKey(new Date(t)));
    if (t >= weekStart && t <= now.getTime()) {
      thisWeek += 1;
      secondsThisWeek += s.actualDurationSec;
    }
  }
  // Streak: walk back day by day from today; a streak may also start
  // yesterday (today's session hasn't happened yet).
  let cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY_MS);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return {
    total: sessions.length,
    thisWeek,
    minutesThisWeek: Math.round(secondsThisWeek / 60),
    currentStreakDays: streak,
    byState,
  };
}
