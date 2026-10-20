import type { MotionTrend } from '../biometrics/motion';

/** One-tap micro-prompt answer at a checkpoint (PRD §17). */
export type CheckpointResponse = 'better' | 'same' | 'worse';

/** Heart-rate trend relative to the session baseline (PRD §17 wearables). */
export type HrTrend = 'rising' | 'falling' | 'stable';

/** Everything observed since the previous checkpoint (or session start). */
export interface SegmentObservation {
  /** null = prompt dismissed / timed out / never shown (sleep, disabled). */
  response: CheckpointResponse | null;
  volumeTweaksInSegment: number;
  customizedInSegment: boolean;
  /** null = no biometric source connected. */
  hrTrend: HrTrend | null;
  /**
   * Phase 16: the phone's motion over the segment (phone on the mattress);
   * null = no live motion sensor. Restless is adverse for calm states.
   * Optional so pre-Phase-16 observations stay valid.
   */
  motionTrend?: MotionTrend | null;
  /**
   * RMSSD trend from RR intervals (Phase 9); null = no source, or the
   * sensor sends no RR data. For calm states *falling* HRV is adverse —
   * roughly the mirror of a rising heart rate.
   */
  hrvTrend: HrTrend | null;
}

export type AdaptationAction =
  | { kind: 'stay' }
  | { kind: 'switch'; armId: string; trigger: 'explicit' | 'implicit' | 'biometric' }
  /** Back to a previously-liked arm; does not count against the switch cap. */
  | { kind: 'revert'; armId: string }
  /** Sleep-only biometric nudge: quieter noise, shallower pulse, same arm. */
  | { kind: 'soften' };
