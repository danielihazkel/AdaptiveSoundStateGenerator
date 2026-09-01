import { useRef, useState } from 'react';
import {
  ADAPT_INTERVAL_SEC,
  decideAdaptation,
  PROMPT_TIMEOUT_SEC,
  softenProfile,
} from '../adaptation/adaptation';
import type { CheckpointResponse } from '../adaptation/types';
import type { AudioEngine } from '../audio/engine';
import { ADAPT_RAMP_TIME_CONSTANT } from '../audio/ramp';
import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { computeHrTrend } from '../biometrics/hrTrend';
import type { BiometricSample } from '../biometrics/types';
import { CANDIDATE_SET_VERSION } from '../personalization/candidates';
import { buildCandidateProfile } from '../personalization/candidates';
import { timeBucketOf } from '../personalization/context';
import type { CheckpointInfo, SessionController } from '../session/sessionController';
import { loadPersonalization } from '../storage/storage';
import type { PersonalizationMode, SessionSegment } from '../storage/types';

export interface SessionMeta {
  state: MentalState;
  intensity: number;
  mode: PersonalizationMode;
  coachUsed: boolean;
  /** The arm the personalizer served, or null for presets/programs/replays. */
  servedArmId: string | null;
}

/**
 * Phase 3 adaptation loop (PRD §17): at each checkpoint close the current
 * per-arm segment, decide (switch / revert / soften / stay), and act. All
 * refs so the checkpoint callbacks (assigned once per session) never see
 * stale state.
 */
export function useAdaptationLoop(deps: {
  getEngine: () => AudioEngine | null;
  getController: () => SessionController | null;
  getHrSamples: () => BiometricSample[];
  setLiveProfile: (profile: SoundProfile) => void;
}) {
  const metaRef = useRef<SessionMeta | null>(null);
  /** Per-arm timeline; a new segment is closed/opened at every checkpoint. */
  const segmentsRef = useRef<SessionSegment[]>([]);
  /** Master-volume tweaks since the current segment opened. */
  const segmentVolumeTweaksRef = useRef(0);
  /** Set once the user touches the advanced panel — stop adapting for good. */
  const disabledRef = useRef(false);
  const switchesRef = useRef(0);
  const softenedRef = useRef(false);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [microPrompt, setMicroPrompt] = useState<CheckpointInfo | null>(null);

  const clearMicroPrompt = () => {
    clearTimeout(promptTimerRef.current);
    setMicroPrompt(null);
  };

  /**
   * Close the current segment at a checkpoint, decide, and act (PRD §17).
   * Adaptation-driven profile changes deliberately bypass the user's profile
   * change handler so volume/customization counters stay pure user signals.
   */
  const runAdaptation = (response: CheckpointResponse | null, info: CheckpointInfo) => {
    const meta = metaRef.current;
    const engine = deps.getEngine();
    const controller = deps.getController();
    const segments = segmentsRef.current;
    const current = segments[segments.length - 1];
    if (!meta || !engine || !controller || !current) return;

    const hr = computeHrTrend(deps.getHrSamples(), {
      recentWindowMs: ADAPT_INTERVAL_SEC * 1000,
      now: Date.now(),
    });

    current.endSec = info.elapsedSec;
    if (response) current.response = response;
    current.volumeAdjustments = segmentVolumeTweaksRef.current;
    if (hr) current.hrDeltaBpm = Math.round(hr.deltaBpm);

    const action = decideAdaptation({
      state: meta.state,
      mode: meta.mode,
      currentArmId: current.armId,
      previousArmIds: segments.slice(0, -1).map((s) => s.armId),
      likedArmIds: segments
        .filter((s) => s.response === 'better' || s.response === 'same')
        .map((s) => s.armId),
      switchesSoFar: switchesRef.current,
      softenedAlready: softenedRef.current,
      observation: {
        response,
        volumeTweaksInSegment: segmentVolumeTweaksRef.current,
        customizedInSegment: false, // customization disables adaptation upstream
        hrTrend: hr?.trend ?? null,
      },
      personalization: loadPersonalization(CANDIDATE_SET_VERSION),
      context: { bucket: timeBucketOf(new Date()), mono: engine.isMonoMode },
    });
    segmentVolumeTweaksRef.current = 0;

    if (action.kind === 'switch' || action.kind === 'revert') {
      const next = buildCandidateProfile(meta.state, meta.intensity, action.armId);
      // Never stomp the user's live volume (their safety/comfort control).
      next.masterVolume = engine.getProfile().masterVolume;
      controller.applyProfile(next, ADAPT_RAMP_TIME_CONSTANT);
      deps.setLiveProfile(next);
      if (action.kind === 'switch') switchesRef.current += 1;
      segments.push({
        armId: action.armId,
        startSec: info.elapsedSec,
        endSec: info.elapsedSec,
        volumeAdjustments: 0,
        trigger:
          action.kind === 'revert'
            ? response === 'worse'
              ? 'explicit'
              : 'implicit'
            : action.trigger,
      });
    } else {
      if (action.kind === 'soften') {
        softenedRef.current = true;
        const next = softenProfile(engine.getProfile());
        controller.applyProfile(next, ADAPT_RAMP_TIME_CONSTANT);
        deps.setLiveProfile(next);
      }
      // Same arm continues — open a fresh segment so per-window tweak counts
      // and any later responses stay attributable.
      segments.push({
        armId: current.armId,
        startSec: info.elapsedSec,
        endSec: info.elapsedSec,
        volumeAdjustments: 0,
        trigger: action.kind === 'soften' ? 'biometric' : undefined,
      });
    }
  };

  const onCheckpoint = (info: CheckpointInfo) => {
    const meta = metaRef.current;
    if (!meta || meta.servedArmId === null || disabledRef.current) return;
    if (meta.state === 'sleep') {
      // Sleep never prompts (PRD §9/§17) — implicit/biometric only.
      runAdaptation(null, info);
      return;
    }
    setMicroPrompt(info);
    clearTimeout(promptTimerRef.current);
    promptTimerRef.current = setTimeout(() => {
      setMicroPrompt(null);
      runAdaptation(null, info);
    }, PROMPT_TIMEOUT_SEC * 1000);
  };

  const answerPrompt = (response: CheckpointResponse | null) => {
    const info = microPrompt;
    clearMicroPrompt();
    if (info) runAdaptation(response, info);
  };

  return {
    microPrompt,
    onCheckpoint,
    answerPrompt,
    getMeta: () => metaRef.current,
    /** Reset every per-session counter and open the initial segment. */
    beginSession: (meta: SessionMeta) => {
      metaRef.current = meta;
      segmentsRef.current =
        meta.servedArmId !== null
          ? [
              {
                armId: meta.servedArmId,
                startSec: 0,
                endSec: 0,
                volumeAdjustments: 0,
                trigger: 'initial',
              },
            ]
          : [];
      segmentVolumeTweaksRef.current = 0;
      disabledRef.current = false;
      switchesRef.current = 0;
      softenedRef.current = false;
      clearMicroPrompt();
    },
    noteVolumeTweak: () => {
      segmentVolumeTweaksRef.current += 1;
    },
    /** Manual control wins — stop adapting for the rest of the session. */
    disable: () => {
      disabledRef.current = true;
      clearMicroPrompt();
    },
    /**
     * The segment timeline to persist — only for sessions that actually
     * adapted or answered a check-in; plain sessions keep the legacy
     * single-arm shape (undefined).
     */
    finalizeSegments: (actualDurationSec: number): SessionSegment[] | undefined => {
      clearMicroPrompt();
      const meta = metaRef.current;
      if (!meta || meta.servedArmId === null || segmentsRef.current.length === 0) {
        return undefined;
      }
      const finalized = segmentsRef.current.map((s) => ({ ...s }));
      const last = finalized[finalized.length - 1];
      last.endSec = actualDurationSec;
      last.volumeAdjustments = segmentVolumeTweaksRef.current;
      const adapted =
        finalized.some((s) => s.response !== undefined) ||
        new Set(finalized.map((s) => s.armId)).size > 1 ||
        softenedRef.current;
      return adapted ? finalized : undefined;
    },
  };
}

export type AdaptationLoop = ReturnType<typeof useAdaptationLoop>;
