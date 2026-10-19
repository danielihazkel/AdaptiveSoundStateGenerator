import type { MentalState } from '../audio/states';
import type { NoiseType } from '../audio/types';
import type { SessionRecord } from '../storage/types';
import { timeBucketOf, type TimeBucket } from './context';

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

/** A weekly card needs at least this many sessions in the last 7 days. */
export const MIN_WEEK_SESSIONS = 3;
/** A noise colour or time of day needs this many rated sessions to be called "best". */
const MIN_GROUP_RATED = 2;

export interface WeeklyReflection {
  sessions: number;
  minutes: number;
  /** Minutes in the 7 days before — null when there were none (nothing to compare). */
  minutesBefore: number | null;
  /** Minutes per state, most first (top three). */
  topStates: Array<{ state: MentalState; minutes: number }>;
  avgRating: number | null;
  avgRatingBefore: number | null;
  /** Highest-rated noise colour this week (≥ MIN_GROUP_RATED rated sessions). */
  bestNoise: NoiseType | null;
  /** Highest-rated time of day this week (≥ MIN_GROUP_RATED rated sessions). */
  bestTime: TimeBucket | null;
  /** Sleep sessions that faded out on detected sleep onset (Phase 9). */
  fellAsleep: number;
}

const mean = (xs: number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** The group key with the best mean rating, among groups with enough rated sessions. */
function bestBy<K extends string>(records: SessionRecord[], key: (r: SessionRecord) => K | null): K | null {
  const groups = new Map<K, number[]>();
  for (const r of records) {
    const k = key(r);
    if (k === null || !r.feedback) continue;
    groups.set(k, [...(groups.get(k) ?? []), r.feedback.rating]);
  }
  let best: K | null = null;
  let bestMean = -Infinity;
  for (const [k, ratings] of groups) {
    const m = mean(ratings)!;
    if (ratings.length >= MIN_GROUP_RATED && m > bestMean) {
      best = k;
      bestMean = m;
    }
  }
  return best;
}

/**
 * The last 7 days at a glance, against the 7 before: how much, what, how
 * well, and what worked best — drawn from the history alone. Null until the
 * week has MIN_WEEK_SESSIONS sessions.
 */
export function weeklyReflection(sessions: SessionRecord[], now: Date): WeeklyReflection | null {
  const end = now.getTime();
  const weekStart = end - 7 * DAY_MS;
  const before = (t: number) => t >= weekStart - 7 * DAY_MS && t < weekStart;
  const week: SessionRecord[] = [];
  const prior: SessionRecord[] = [];
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (Number.isNaN(t) || t > end) continue;
    if (t >= weekStart) week.push(s);
    else if (before(t)) prior.push(s);
  }
  if (week.length < MIN_WEEK_SESSIONS) return null;
  const minutesOf = (rs: SessionRecord[]) =>
    Math.round(rs.reduce((acc, r) => acc + r.actualDurationSec, 0) / 60);
  const byState = new Map<MentalState, number>();
  for (const r of week) byState.set(r.state, (byState.get(r.state) ?? 0) + r.actualDurationSec);
  const ratings = (rs: SessionRecord[]) => rs.flatMap((r) => (r.feedback ? [r.feedback.rating] : []));
  return {
    sessions: week.length,
    minutes: minutesOf(week),
    minutesBefore: prior.length > 0 ? minutesOf(prior) : null,
    topStates: [...byState]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([state, sec]) => ({ state, minutes: Math.round(sec / 60) })),
    avgRating: mean(ratings(week)),
    avgRatingBefore: mean(ratings(prior)),
    bestNoise: bestBy(week, (r) => (r.profile?.noise?.enabled ? r.profile.noise.type : null)),
    bestTime: bestBy(week, (r) => timeBucketOf(new Date(r.startedAt))),
    fellAsleep: week.filter((r) => r.sleepOnsetSec !== undefined).length,
  };
}
