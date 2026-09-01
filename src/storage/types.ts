import type { BreathingPatternId } from '../audio/breathing';
import type { MentalState } from '../audio/states';
import type { IntervalPlan } from '../programs/intervals';
import type { SoundProfile } from '../audio/types';
import type { ExportOptions } from '../export/options';

/**
 * Local-first persistence model (PRD §14): everything on-device, no account.
 * A SessionRecord is deliberately shaped as the Phase 2 training row —
 * user → state → config → result, with the implicit signals from PRD §9
 * (early stop, volume tweaks, preset replays) captured from day one.
 */
export const SCHEMA_VERSION = 1;

/** PRD §9 explore-vs-exploit: "lock what works" vs "keep experimenting". */
export type PersonalizationMode = 'explore' | 'locked';

export interface Settings {
  schemaVersion: typeof SCHEMA_VERSION;
  disclaimerAcknowledgedAt: string | null;
  monoMode: boolean;
  chimeEnabled: boolean;
  /** Per-state lock toggle; missing state = 'explore'. */
  personalizationMode?: Partial<Record<MentalState, PersonalizationMode>>;
  /** Phase 3 mid-session adaptation loop master switch (PRD §17). */
  adaptationEnabled?: boolean;
  /** ISO timestamp of explicit wearable-data consent (PRD §14); null = none. */
  biometricsConsentAt?: string | null;
  /** Guided breathing for calm/relax/meditation; absent = follow the pulse. */
  breathingPattern?: BreathingPatternId;
  /** Sleep sessions: rise gently over the last `riseMinutes` and end with a chime. */
  wakeUp?: { enabled: boolean; riseMinutes: number };
  /**
   * Phase 9 (opt-in, needs a heart-rate sensor): fade a sleep session out as
   * completed once sleep onset is detected. Absent = off — a session must
   * never end early without the user having asked for it.
   */
  sleepOnsetFade?: boolean;
  /** Color theme; absent = follow the OS. */
  theme?: Theme;
  /** ISO timestamp the first-run tour was finished or skipped; absent = not yet. */
  onboardingCompletedAt?: string | null;
  /** Download format / bitrate; absent = MP3 192 kbps. */
  export?: ExportOptions;
}

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export const DEFAULT_WAKE_UP = { enabled: false, riseMinutes: 10 } as const;
export const MIN_WAKE_RISE_MINUTES = 3;
export const MAX_WAKE_RISE_MINUTES = 30;

export const defaultSettings: Settings = {
  schemaVersion: SCHEMA_VERSION,
  disclaimerAcknowledgedAt: null,
  monoMode: false,
  chimeEnabled: true,
  personalizationMode: {},
  adaptationEnabled: true,
  biometricsConsentAt: null,
};

export function modeFor(settings: Settings, state: MentalState): PersonalizationMode {
  return settings.personalizationMode?.[state] ?? 'explore';
}

export interface Preset {
  id: string;
  name: string;
  createdAt: string; // ISO
  state: MentalState;
  intensity: number;
  profile: SoundProfile;
  /** Pinned to the top of its state's strip. Absent on presets saved before this existed. */
  favorite?: boolean;
  /**
   * The session this preset was saved from, when it was saved from the
   * feedback screen. Lets a preset replay credit the arm that produced the
   * sound (PRD §15: replaying a liked sound is a positive label).
   */
  sourceSessionId?: string;
}

export type Rating = 1 | 2 | 3 | 4 | 5;
/** PRD §9 "Distraction" scale: 1 = not at all, 2 = a little, 3 = very. */
export type Distraction = 1 | 2 | 3;

/** What the feedback screen collects: the rating, plus two optional PRD §9 questions. */
export interface FeedbackInput {
  rating: Rating;
  distraction?: Distraction;
  /** "Would you use this again?" */
  useAgain?: boolean;
}

/**
 * One stretch of a session played under a single arm (Phase 3, PRD §17).
 * Only sessions that adapted (or answered a micro-prompt) carry segments;
 * plain sessions keep the legacy single-arm shape.
 */
export interface SessionSegment {
  armId: string;
  startSec: number;
  endSec: number;
  /** Micro-prompt answer that closed this segment, if any. */
  response?: 'better' | 'same' | 'worse';
  /** Master-volume tweaks made during this segment. */
  volumeAdjustments: number;
  /** What opened this segment. */
  trigger?: 'initial' | 'explicit' | 'implicit' | 'biometric';
  /** HR delta vs session baseline at segment close — raw HR is never stored. */
  hrDeltaBpm?: number;
  /** RMSSD change vs the session baseline in this segment, signed % (Phase 9). */
  hrvDeltaPct?: number;
}

export interface SessionRecord {
  id: string;
  startedAt: string; // ISO
  state: MentalState;
  intensity: number;
  plannedDurationSec: number;
  actualDurationSec: number;
  /** false = stopped early — an implicit signal (PRD §9). */
  completed: boolean;
  /** true when the advanced panel was touched during the session. */
  customized: boolean;
  /** Count of mid-session master-volume changes — implicit signal (PRD §9). */
  volumeAdjustments: number;
  monoMode: boolean;
  /** Replaying a saved preset is a high-confidence positive label (PRD §15). */
  presetId?: string;
  /**
   * Session ran a timed program (programs/types.ts). Program sessions never
   * touch the bandit or mid-session adaptation — servedArmId/servedBy absent.
   */
  programId?: string;
  /** Replayed the exact profile of this earlier session (history screen). */
  replayOfSessionId?: string;
  /** Full configuration the session actually played — Phase 2 optimizer input. */
  profile: SoundProfile;
  feedback?: {
    rating: Rating;
    ratedAt: string; // ISO
    /** Optional PRD §9 extras; absent on records rated before they existed. */
    distraction?: Distraction;
    useAgain?: boolean;
  };
  /** Bandit candidate recipe that produced the served profile (absent for presets). */
  servedArmId?: string;
  /** How the starting profile was chosen. Absent on pre-Phase-2 records. */
  servedBy?: 'prior' | 'bandit' | 'locked' | 'preset';
  /**
   * Sleep-onset wind-down (Phase 9): elapsed seconds at which the heart
   * rate said "asleep" and the session faded out early as completed.
   */
  sleepOnsetSec?: number;
  /** User explicitly declined to rate — itself an implicit signal (PRD §9). */
  feedbackSkipped?: boolean;
  /** ISO timestamp of the bandit update — guards against double-counting. */
  banditResolvedAt?: string;
  /** Per-arm timeline when the session adapted mid-way (Phase 3, PRD §17). */
  segments?: SessionSegment[];
  /** Session was configured via the natural-language coach (PRD §11). */
  coachUsed?: boolean;
  /** A biometric source was connected during the session. */
  biometricsUsed?: boolean;
  /** Guided breathing pattern the mix followed (absent = none / pulse-derived). */
  breathingPattern?: Exclude<BreathingPatternId, 'pulse'>;
  /** The session closed with a wake-up rise of this length. */
  wakeUp?: { riseSec: number };
  /** Ran a generated interval (Pomodoro) program — programId stays unset. */
  intervals?: IntervalPlan;
  /**
   * "Until I stop": no planned length (plannedDurationSec equals the actual
   * length). Stop was the natural end, so `completed` is true.
   */
  openEnded?: true;
  /**
   * Reconstructed from the in-progress checkpoint after the app died
   * mid-session. Not the user's choice to stop, so it carries no bandit
   * signal (reward.ts) and is never offered for rating.
   */
  recovered?: true;
}

/**
 * Checkpoint of the session currently playing, rewritten every
 * CHECKPOINT_EVERY_SEC (session/inProgress.ts). Exactly what handleComplete
 * needs to build a SessionRecord if the app never gets to.
 */
export interface InProgressSession {
  startedAt: string; // ISO
  state: MentalState;
  intensity: number;
  plannedDurationSec: number;
  profile: SoundProfile;
  monoMode: boolean;
  presetId?: string;
  programId?: string;
  intervals?: IntervalPlan;
  replayOfSessionId?: string;
  servedArmId?: string;
  servedBy?: SessionRecord['servedBy'];
  breathingPattern?: SessionRecord['breathingPattern'];
  wakeUp?: { riseSec: number };
  openEnded?: true;
  /** Sleep onset already detected at this elapsed second (Phase 9). */
  sleepOnsetSec?: number;
  /** Listening time at the last checkpoint. */
  elapsedSec: number;
  updatedAt: string; // ISO
}

// --- Personalization (Phase 2, PRD §9/§16) ----------------------------------

/**
 * Sufficient statistics for one bandit arm. Weighted: n is a sum of session
 * weights (0..1 each), not a count. sumSq is kept so posterior variance could
 * use empirical spread later without a schema change.
 */
export interface ArmStats {
  n: number;
  sum: number;
  sumSq: number;
}

export interface PersonalizationState {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Must match candidates.ts CANDIDATE_SET_VERSION or stats are rebuilt/reset. */
  candidateSetVersion: number;
  arms: Partial<Record<MentalState, Record<string, ArmStats>>>;
  /**
   * Sessions resolved per state — an undecayed count, so the cold-start gate
   * keeps meaning "N sessions" while the arm statistics above decay toward
   * recent evidence (bandit.ts). Absent on payloads from before decay existed;
   * eligibleSessionCount then falls back to Σn.
   */
  resolved?: Partial<Record<MentalState, number>>;
  /**
   * Per-(state, context) arm statistics for the contextual bandit
   * (personalization/context.ts): state → context key → arm id → stats.
   * Optional and fully rebuildable from the session records.
   */
  contexts?: Partial<Record<MentalState, Record<string, Record<string, ArmStats>>>>;
}
