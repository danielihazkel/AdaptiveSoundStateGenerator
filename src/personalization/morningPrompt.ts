import type { SessionRecord } from '../storage/types';

/**
 * Next-morning feedback for sleep sessions (PRD §9): the user is asleep at
 * session end, so the rating is collected on the next app open instead.
 * Pure eligibility over session records — no storage of its own.
 */
export const PROMPT_WINDOW_HOURS = 18;

export function sessionEndMs(record: SessionRecord): number {
  return Date.parse(record.startedAt) + record.actualDurationSec * 1000;
}

/** True once a session's rating opportunity has lapsed (prompt or feedback screen). */
export function ratingWindowExpired(record: SessionRecord, now: Date): boolean {
  return now.getTime() - sessionEndMs(record) > PROMPT_WINDOW_HOURS * 3600 * 1000;
}

/**
 * The sleep session to ask about this morning, or null. Only completed sleep
 * sessions qualify (early-stopped ones already saw the normal feedback screen);
 * anything rated, skipped, or older than the window is excluded. Most recent wins;
 * older unresolved sessions are settled implicit-only by the resolution sweep.
 */
export function findPendingMorningPrompt(
  sessions: SessionRecord[],
  now: Date,
): SessionRecord | null {
  let latest: SessionRecord | null = null;
  for (const record of sessions) {
    if (record.state !== 'sleep' || !record.completed) continue;
    if (record.feedback || record.feedbackSkipped) continue;
    if (ratingWindowExpired(record, now)) continue;
    if (!latest || sessionEndMs(record) > sessionEndMs(latest)) latest = record;
  }
  return latest;
}
