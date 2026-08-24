import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import {
  loadPersonalization,
  loadSessions,
  markBanditResolved,
  savePersonalization,
} from '../storage/storage';
import type { PersonalizationMode } from '../storage/types';
import {
  bestArm,
  COLD_START_SESSIONS,
  eligibleSessionCount,
  sampleArm,
  updateArm,
} from './bandit';
import {
  buildCandidateProfile,
  CANDIDATE_SET_VERSION,
  PRIOR_ARM_ID,
} from './candidates';
import { ratingWindowExpired } from './morningPrompt';
import { computeCredits } from './reward';

/**
 * The orchestration seam between the pure bandit and storage — the only
 * personalization module that reads or writes localStorage.
 *
 * Storage here is read-modify-write with no cross-tab coordination (the same
 * single-tab assumption presets already make); a second open tab could lose an
 * update, which at this data scale is acceptable.
 */
export interface ServedProfile {
  profile: SoundProfile;
  armId: string;
  servedBy: 'prior' | 'bandit' | 'locked';
}

/**
 * Decides the starting profile for a non-preset session (PRD §9):
 * cold start ⇒ the state default (still tracked, so the baseline arm
 * accumulates stats); locked ⇒ best known arm; otherwise Thompson sample.
 */
export function chooseProfile(
  mental: MentalState,
  intensity: number,
  mode: PersonalizationMode,
  rng: () => number = Math.random,
): ServedProfile {
  const state = loadPersonalization(CANDIDATE_SET_VERSION);
  let armId: string;
  let servedBy: ServedProfile['servedBy'];
  if (eligibleSessionCount(state, mental) < COLD_START_SESSIONS) {
    armId = PRIOR_ARM_ID;
    servedBy = 'prior';
  } else if (mode === 'locked') {
    armId = bestArm(state, mental);
    servedBy = 'locked';
  } else {
    armId = sampleArm(state, mental, rng);
    servedBy = 'bandit';
  }
  return { profile: buildCandidateProfile(mental, intensity, armId), armId, servedBy };
}

/**
 * Feeds one finished session's rewards into its served arm(s) — one credit
 * per adapted segment plus the end-of-session score (Phase 3), or the single
 * legacy credit for non-adapted sessions. Idempotent: the banditResolvedAt
 * stamp guarantees a session is counted at most once, no matter how many
 * paths (rating, skip, expiry sweep) call this.
 */
export function resolveOutcome(sessionId: string): void {
  const record = loadSessions().find((s) => s.id === sessionId);
  if (!record || !record.servedArmId || record.banditResolvedAt) return;
  const credits = computeCredits(record);
  if (credits.length > 0) {
    let state = loadPersonalization(CANDIDATE_SET_VERSION);
    for (const credit of credits) {
      state = updateArm(state, record.state, credit.armId, credit.reward);
    }
    savePersonalization(state);
  }
  markBanditResolved(sessionId);
}

/**
 * Startup sweep: settles every session whose rating opportunity has concluded —
 * rated, explicitly skipped, or past the rating window (catches the app being
 * closed on the feedback screen and expired morning prompts, which then count
 * implicit-only).
 */
export function resolvePendingOutcomes(now: Date = new Date()): void {
  for (const record of loadSessions()) {
    if (!record.servedArmId || record.banditResolvedAt) continue;
    if (record.feedback || record.feedbackSkipped || ratingWindowExpired(record, now)) {
      resolveOutcome(record.id);
    }
  }
}
