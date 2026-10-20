import type { MentalState } from '../audio/states';
import type { PersonalizationState } from '../storage/types';
import { bestArm, COLD_START_SESSIONS, eligibleSessionCount, servePosterior } from './bandit';
import { candidatesFor, PRIOR_ARM_ID } from './candidates';
import type { ServeContext } from './context';
import { ARM_CI_Z } from './insights';
import type { ServedProfile } from './personalizer';

/**
 * "Why this sound" (Phase 15, PRD §20 transparency): one plain sentence on
 * the session screen saying which variation is playing, why the personalizer
 * picked it, and — once there is evidence — how it has scored for this user.
 * Pure: the caller hands in the posterior (personalizer.describeServedSound).
 */
export type SessionSoundKind = 'served' | 'preset' | 'replay' | 'program';

export interface ExplainInput {
  state: MentalState;
  kind: SessionSoundKind;
  /** What the personalizer served at the start ('served' sessions only). */
  servedArmId?: string;
  servedBy?: ServedProfile['servedBy'];
  /** The arm playing now — differs from servedArmId after an adaptation switch. */
  currentArmId?: string;
  ctx?: ServeContext;
}

export interface SoundExplanation {
  /** The variation in plain words, e.g. "Warmer tone". */
  label: string;
  /** Why it is playing, e.g. "Trying a variation". */
  reason: string;
  /** Posterior mean as a percentage — absent until the arm has evidence. */
  scorePct?: number;
  /** 95 % half-interval, in percentage points. */
  ciPct?: number;
  /** Detail for sounds the personalizer doesn't score (presets, replays). */
  note?: string;
}

export function armLabel(state: MentalState, armId: string): string {
  return candidatesFor(state).find((c) => c.id === armId)?.label ?? 'State default';
}

export function explainServed(
  input: ExplainInput,
  personalization: PersonalizationState,
): SoundExplanation | null {
  switch (input.kind) {
    case 'program':
      // The program readout already says what is playing and why.
      return null;
    case 'preset':
      return {
        label: 'Your saved sound',
        reason: 'Exactly as you saved it',
        note: 'Saved sounds play as they are — the app never adjusts them mid-session.',
      };
    case 'replay':
      return {
        label: 'An earlier session',
        reason: 'Replaying the exact sound',
        note: 'A replay plays the recorded sound as it was — the app never adjusts it mid-session.',
      };
    case 'served':
      break;
  }
  const { state, servedArmId, servedBy, ctx } = input;
  if (!servedArmId || !servedBy) return null;
  const armId = input.currentArmId ?? servedArmId;
  const adapted = armId !== servedArmId;

  let reason: string;
  if (adapted) {
    reason = 'Switched after a check-in';
  } else if (servedBy === 'prior') {
    const session = Math.min(COLD_START_SESSIONS, eligibleSessionCount(personalization, state) + 1);
    reason = `Learning your taste — session ${session} of ${COLD_START_SESSIONS}`;
  } else if (servedBy === 'baseline') {
    reason = 'Checking the default against your favourites';
  } else if (servedBy === 'locked') {
    reason = 'Your best so far';
  } else if (servedBy === 'pinned') {
    reason = 'You picked this from your sound profile';
  } else if (armId === bestArm(personalization, state, ctx)) {
    reason = 'Your current favourite';
  } else {
    reason = 'Trying a variation';
  }

  const explanation: SoundExplanation = { label: armLabel(state, armId), reason };
  const stats = personalization.arms[state]?.[armId];
  if (stats && stats.n > 0) {
    // The same posterior the bandit decided with (context, mood, pooled prior).
    const { mean, std } = servePosterior(personalization, state, armId, ctx);
    explanation.scorePct = Math.round(mean * 100);
    explanation.ciPct = Math.round(ARM_CI_Z * std * 100);
  }
  if (armId === PRIOR_ARM_ID && !adapted && servedBy !== 'baseline') {
    explanation.label = 'The default sound';
  }
  return explanation;
}
