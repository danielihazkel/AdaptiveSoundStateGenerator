import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import {
  loadPersonalization,
  loadPresets,
  loadSessions,
  markBanditResolved,
  peekPersonalizationVersion,
  savePersonalization,
} from '../storage/storage';
import type { PersonalizationMode } from '../storage/types';
import {
  bestArm,
  COLD_START_SESSIONS,
  decayState,
  eligibleSessionCount,
  rebuildFromSessions,
  sampleArm,
  updateArm,
} from './bandit';
import {
  buildCandidateProfile,
  CANDIDATE_SET_VERSION,
  PRIOR_ARM_ID,
} from './candidates';
import { contextOf, type ServeContext } from './context';
import { ratingWindowExpired } from './morningPrompt';
import { computeCredits, hasBanditSignal } from './reward';
import { makeSourceArmResolver } from './sourceArm';

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
  servedBy: 'prior' | 'bandit' | 'locked' | 'baseline';
}

/**
 * Held-out baseline (PRD §18): after cold start, every HOLDOUT_EVERY-th
 * explore session serves the pure state default, tagged 'baseline'. That
 * gives the "is personalization working?" comparison a control group spread
 * across the whole history — the early 'prior' sessions alone are
 * confounded with the user settling into the app. The session still trains
 * the bandit (the default *is* the prior arm). Locked mode never holds out:
 * "lock what works" is a promise not to experiment.
 */
export const HOLDOUT_EVERY = 8;
/** Which post-cold-start slot is held out (0-based): the 4th, then every 8th. */
export const HOLDOUT_SLOT = 3;

function isHoldoutSlot(eligibleSessions: number): boolean {
  const past = eligibleSessions - COLD_START_SESSIONS;
  return past >= 0 && past % HOLDOUT_EVERY === HOLDOUT_SLOT;
}

/**
 * Decides the starting profile for a non-preset session (PRD §9):
 * cold start ⇒ the state default (still tracked, so the baseline arm
 * accumulates stats); locked ⇒ best known arm; held-out slot ⇒ the state
 * default again, tagged 'baseline'; otherwise Thompson sample.
 */
export function chooseProfile(
  mental: MentalState,
  intensity: number,
  mode: PersonalizationMode,
  rng: () => number = Math.random,
  /** Where/how this session is served — time of day, speakers vs headphones. */
  ctx?: ServeContext,
): ServedProfile {
  const state = loadPersonalization(CANDIDATE_SET_VERSION);
  const eligible = eligibleSessionCount(state, mental);
  let armId: string;
  let servedBy: ServedProfile['servedBy'];
  if (eligible < COLD_START_SESSIONS) {
    armId = PRIOR_ARM_ID;
    servedBy = 'prior';
  } else if (mode === 'locked') {
    armId = bestArm(state, mental, ctx);
    servedBy = 'locked';
  } else if (isHoldoutSlot(eligible)) {
    armId = PRIOR_ARM_ID;
    servedBy = 'baseline';
  } else {
    armId = sampleArm(state, mental, rng, ctx);
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
  const sessions = loadSessions();
  const record = sessions.find((s) => s.id === sessionId);
  if (!record || !hasBanditSignal(record) || record.banditResolvedAt) return;
  const credits = computeCredits(record, {
    sourceArm: makeSourceArmResolver(sessions, loadPresets()),
  });
  if (credits.length > 0) {
    // Credit lands in the context the session was actually served in.
    const ctx = contextOf(record.startedAt, record.monoMode) ?? undefined;
    let state = decayState(loadPersonalization(CANDIDATE_SET_VERSION), record.state);
    for (const credit of credits) {
      state = updateArm(state, record.state, credit.armId, credit.reward, ctx);
    }
    savePersonalization(state);
  }
  markBanditResolved(sessionId);
}

/**
 * Candidate-set bumps are additive (candidates.ts): every stored arm keeps
 * its id and meaning, so the learning a user has accumulated stays valid.
 * Instead of the reset loadPersonalization would apply on a version mismatch,
 * rebuild the posterior from the session records under the current version.
 * Call once at startup, before anything reads the posterior.
 */
export function ensurePersonalizationVersion(): void {
  const stored = peekPersonalizationVersion();
  if (stored === null || stored === CANDIDATE_SET_VERSION) return;
  savePersonalization(rebuildFromSessions(loadSessions(), loadPresets()));
}

/**
 * Startup sweep: settles every session whose rating opportunity has concluded —
 * rated, explicitly skipped, or past the rating window (catches the app being
 * closed on the feedback screen and expired morning prompts, which then count
 * implicit-only).
 */
export function resolvePendingOutcomes(now: Date = new Date()): void {
  for (const record of loadSessions()) {
    if (!hasBanditSignal(record) || record.banditResolvedAt) continue;
    if (record.feedback || record.feedbackSkipped || ratingWindowExpired(record, now)) {
      resolveOutcome(record.id);
    }
  }
}
