import { useEffect, useRef, useState } from 'react';
import { useStableCallback } from './useStableCallback';
import { ADAPT_INTERVAL_SEC, END_GUARD_SEC } from '../adaptation/adaptation';
import { BREATH_PATTERNS, type BreathPattern } from '../audio/breathing';
import { AudioEngine } from '../audio/engine';
import type { MentalState } from '../audio/states';
import { cloneProfile, normalizeProfile, type SoundProfile } from '../audio/types';
import { chooseProfile, type ServedProfile } from '../personalization/personalizer';
import { playSilentKeepAlive } from '../platform/silentAudio';
import { programMinDurationSec, type Program } from '../programs/types';
import { IDENTITY_MODULATION } from '../session/evolution';
import { CHECKPOINT_EVERY_SEC } from '../session/inProgress';
import { breathingFor, wakeUpFor } from '../session/sessionOptions';
import { SessionController, type SessionResult } from '../session/sessionController';
import {
  appendSession,
  clearInProgress,
  newId,
  saveInProgress,
  savePreset,
} from '../storage/storage';
import {
  modeFor,
  type InProgressSession,
  type Preset,
  type SessionRecord,
  type Settings,
} from '../storage/types';
import { START_ERROR_MESSAGE } from '../ui/SafetyNotices';
import type { AdaptationLoop } from './useAdaptationLoop';
import type { Biometrics } from './useBiometrics';
import type { Coach } from './useCoach';
import type { SetupSelection } from './useSetupSelection';
import { resolveSessionProgram } from './resolveSessionProgram';
import type { IntervalPlan } from '../programs/intervals';

export interface FinishedSession {
  recordId: string;
  state: MentalState;
  intensity: number;
  profile: SoundProfile;
  completed: boolean;
}

/** Everything except the master volume — separates "tweaked the sound"
 * (customized) from "adjusted the volume" (implicit signal, PRD §9). */
function soundFingerprint(profile: SoundProfile): string {
  return JSON.stringify({ ...profile, masterVolume: 0 });
}

/**
 * Owns the shared AudioEngine + SessionController and the lifecycle of one
 * session: resolving what to play (program > preset > replay > personalized),
 * starting, tracking the user's live edits, and turning the result into a
 * SessionRecord. The adaptation loop and biometrics are collaborators; this
 * hook wires them into the controller callbacks.
 */
export function useSessionOrchestrator(deps: {
  settings: Settings;
  selection: SetupSelection;
  presets: Preset[];
  programs: Program[];
  adaptation: AdaptationLoop;
  biometrics: Biometrics;
  coach: Coach;
  /** A session record was written — refresh stored-data views. */
  onSessionStored: () => void;
  onPresetSaved: () => void;
  /** Where to go once the session is over. */
  onFinished: (next: 'setup' | 'feedback') => void;
  onSessionStarted: () => void;
}) {
  const engineRef = useRef<AudioEngine | null>(null);
  const controllerRef = useRef<SessionController | null>(null);
  const customizedRef = useRef(false);
  const volumeAdjustmentsRef = useRef(0);
  const lastSessionRef = useRef<FinishedSession | null>(null);
  /** What the personalizer served for the running session (null for presets). */
  const servedRef = useRef<ServedProfile | null>(null);
  /** Program driving the currently running session, if any. */
  const sessionProgramRef = useRef<Program | null>(null);
  /** Guided breathing pattern of the running session, if any (drives the pacer). */
  const sessionBreathingRef = useRef<BreathPattern | null>(null);
  /** Interval plan behind a generated program (recorded instead of a programId). */
  const sessionIntervalsRef = useRef<IntervalPlan | null>(null);
  /** Checkpoint of the running session (minus elapsed), rewritten as it plays. */
  const checkpointRef = useRef<Omit<InProgressSession, 'elapsedSec' | 'updatedAt'> | null>(null);
  const unsubscribeCheckpointRef = useRef<(() => void) | null>(null);

  const [liveProfile, setLiveProfile] = useState<SoundProfile | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { settings, selection, adaptation, biometrics, coach } = deps;

  const stopCheckpointing = () => {
    unsubscribeCheckpointRef.current?.();
    unsubscribeCheckpointRef.current = null;
    checkpointRef.current = null;
    clearInProgress();
  };

  /**
   * Keep a checkpoint of the running session so a tab kill or crash still
   * leaves a history record (useStoredData recovers it on the next launch).
   */
  const startCheckpointing = (controller: SessionController) => {
    let lastBucket = -1;
    const write = (elapsedSec: number) => {
      const base = checkpointRef.current;
      if (!base) return;
      saveInProgress({ ...base, elapsedSec, updatedAt: new Date().toISOString() });
    };
    write(0);
    unsubscribeCheckpointRef.current = controller.subscribe(() => {
      const { elapsedSec } = controller.getSnapshot();
      const bucket = Math.floor(elapsedSec / CHECKPOINT_EVERY_SEC);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        write(elapsedSec);
      }
    });
  };

  const handleComplete = (result: SessionResult) => {
    stopCheckpointing();
    const engine = engineRef.current;
    const profile = engine?.getProfile() ?? result.config.profile;
    const served = servedRef.current;
    const meta = adaptation.getMeta();
    const record: SessionRecord = {
      id: newId(),
      startedAt: result.startedAt,
      state: result.config.state,
      intensity: result.config.intensity,
      plannedDurationSec: result.config.durationSec,
      actualDurationSec: result.actualDurationSec,
      completed: result.completed,
      customized: customizedRef.current,
      volumeAdjustments: volumeAdjustmentsRef.current,
      monoMode: engine?.isMonoMode ?? false,
      presetId: result.config.presetId,
      programId: sessionIntervalsRef.current ? undefined : result.config.program?.id,
      intervals: sessionIntervalsRef.current ?? undefined,
      replayOfSessionId: result.config.replayOfSessionId,
      profile,
      // The arm id travels in the record so the reward lands on the right arm
      // even if the app reloads before the rating arrives.
      servedArmId: served?.armId,
      servedBy: result.config.presetId ? 'preset' : served?.servedBy,
      segments: adaptation.finalizeSegments(result.actualDurationSec),
      coachUsed: meta?.coachUsed || undefined,
      biometricsUsed: biometrics.wasUsed() || undefined,
      breathingPattern:
        result.config.breathing && result.config.breathing.id !== 'pulse'
          ? result.config.breathing.id
          : undefined,
      wakeUp: result.config.wakeUp,
    };
    appendSession(record);
    deps.onSessionStored();
    sessionProgramRef.current = null;
    sessionBreathingRef.current = null;
    sessionIntervalsRef.current = null;
    lastSessionRef.current = {
      recordId: record.id,
      state: record.state,
      intensity: record.intensity,
      profile,
      completed: record.completed,
    };
    // A completed sleep session gets no rating prompt — the user is asleep
    // (PRD §9; the next-morning prompt asks instead) — unless it woke them
    // up on purpose, in which case they can rate it now.
    const asleep = record.completed && record.state === 'sleep' && !record.wakeUp;
    deps.onFinished(asleep ? 'setup' : 'feedback');
  };

  // The controller's callbacks are assigned once (engine creation / session
  // start) but must always run the latest render's closures.
  const stableHandleComplete = useStableCallback(handleComplete);
  const stableOnCheckpoint = useStableCallback(adaptation.onCheckpoint);

  // Release the audio graph and timers if the app root ever unmounts.
  useEffect(
    () => () => {
      unsubscribeCheckpointRef.current?.();
      controllerRef.current?.dispose();
      engineRef.current?.dispose();
      controllerRef.current = null;
      engineRef.current = null;
    },
    [],
  );

  /** Lazily create the shared engine + controller (needs a user gesture). */
  const ensureEngine = async (profile: SoundProfile): Promise<AudioEngine> => {
    if (!engineRef.current) {
      engineRef.current = await AudioEngine.create(profile);
      engineRef.current.setMonoMode(settings.monoMode);
      const controller = new SessionController(engineRef.current);
      controller.onComplete = stableHandleComplete;
      controller.onCheckpoint = stableOnCheckpoint;
      controllerRef.current = controller;
    }
    return engineRef.current;
  };

  /**
   * Start a session from the setup selection — or, with `replayOf`, replay
   * that record directly ("Play last"), bypassing the selection so it can be
   * called in the same gesture as the tap without waiting for a re-render.
   */
  const begin = async (opts: { replayOf?: SessionRecord } = {}) => {
    if (starting) return;
    // Synchronously inside the tap: iOS only starts media from a gesture, and
    // the keep-alive is what lets the session survive a locked screen.
    playSilentKeepAlive();
    setStarting(true);
    setStartError(null);
    try {
      const direct = opts.replayOf ?? null;
      const mentalState = direct?.state ?? selection.mentalState;
      const intensity = direct?.intensity ?? selection.intensity;
      const minutes = direct
        ? Math.max(1, Math.round(direct.plannedDurationSec / 60))
        : selection.resolveMinutes();
      const selectedPreset = direct
        ? undefined
        : deps.presets.find(
            (p) => p.id === selection.selectedPresetId && p.state === mentalState,
          );
      const resolved = resolveSessionProgram({
        programs: deps.programs,
        selectedProgramId: direct ? undefined : selection.selectedProgramId,
        intervals: direct ? null : selection.intervals,
        state: mentalState,
        intensity,
        presetProfile: selectedPreset?.profile,
      });
      const program = resolved.program;
      // A saved program owns the sound; a generated interval program is
      // built on the preset, which stays attributed.
      const preset = program && !resolved.generated ? undefined : selectedPreset;
      sessionIntervalsRef.current = resolved.generated ? selection.intervals : null;
      // A history replay only applies to the state it was recorded for.
      const replaying = direct ?? (!program && !preset ? selection.replay : null);
      let profile: SoundProfile;
      if (program) {
        // Program sessions play the program's snapshot; like presets they
        // bypass the bandit entirely.
        profile = normalizeProfile(program.baseProfile);
        servedRef.current = null;
      } else if (preset) {
        profile = cloneProfile(preset.profile);
        servedRef.current = null;
      } else if (replaying) {
        // Stored profiles may predate schema additions — complete them.
        profile = normalizeProfile(replaying.profile);
        servedRef.current = null;
      } else {
        const served = chooseProfile(mentalState, intensity, modeFor(settings, mentalState));
        profile = served.profile;
        servedRef.current = served;
      }
      sessionProgramRef.current = program ?? null;
      const breathingId = program ? null : breathingFor(mentalState, settings.breathingPattern);
      const breathing = breathingId ? BREATH_PATTERNS[breathingId] : undefined;
      sessionBreathingRef.current = breathing ?? null;

      await ensureEngine(profile);
      customizedRef.current = false;
      volumeAdjustmentsRef.current = 0;

      const sessionState = program ? program.baseState : mentalState;
      const sessionIntensity = program
        ? program.baseIntensity
        : preset
          ? preset.intensity
          : intensity;
      adaptation.beginSession({
        state: sessionState,
        intensity: sessionIntensity,
        mode: modeFor(settings, sessionState),
        coachUsed: coach.consumeApplied(),
        servedArmId: servedRef.current?.armId ?? null,
      });
      coach.reset();
      biometrics.resetForSession();

      // Presets adapt away from the exact sound the user chose — never do
      // that. The toggle turns checkpoints off entirely. Program sessions
      // never adapt either (v1): the program owns the session's shape.
      const adaptationOn =
        !preset && !program && !replaying && settings.adaptationEnabled !== false;
      // A program's closed phases must all play out; extra time extends the
      // open-ended final phase.
      const durationSec = program
        ? resolved.generated
          ? programMinDurationSec(program)
          : Math.max(minutes * 60, programMinDurationSec(program))
        : minutes * 60;
      const wakeUp = program ? undefined : (wakeUpFor(sessionState, settings.wakeUp, durationSec) ?? undefined);
      setLiveProfile(profile);
      const controller = controllerRef.current!;
      await controller.start({
        state: sessionState,
        intensity: sessionIntensity,
        durationSec,
        profile,
        presetId: preset?.id,
        replayOfSessionId: replaying?.id,
        program,
        chimeEnabled: settings.chimeEnabled,
        breathing,
        wakeUp,
        checkpointSec: adaptationOn ? ADAPT_INTERVAL_SEC : undefined,
        endGuardSec: END_GUARD_SEC,
      });
      checkpointRef.current = {
        startedAt: new Date().toISOString(),
        state: sessionState,
        intensity: sessionIntensity,
        plannedDurationSec: durationSec,
        profile: cloneProfile(profile),
        monoMode: engineRef.current?.isMonoMode ?? false,
        presetId: preset?.id,
        programId: sessionIntervalsRef.current ? undefined : program?.id,
        intervals: sessionIntervalsRef.current ?? undefined,
        replayOfSessionId: replaying?.id,
        servedArmId: servedRef.current?.armId,
        servedBy: preset ? 'preset' : servedRef.current?.servedBy,
        breathingPattern: breathing && breathing.id !== 'pulse' ? breathing.id : undefined,
        wakeUp,
      };
      startCheckpointing(controller);
      deps.onSessionStarted();
    } catch (err) {
      // AudioContext blocked, worklet failed to load, no output device… The
      // controller may be mid-start; stop it so the next Begin starts clean.
      console.error('Session failed to start', err);
      stopCheckpointing();
      try {
        controllerRef.current?.stop();
      } catch {
        // already idle
      }
      setStartError(START_ERROR_MESSAGE);
    } finally {
      setStarting(false);
    }
  };

  // Stable identity so the memoized AdvancedPanel doesn't re-render on every
  // 500 ms session tick.
  const handleProfileChange = useStableCallback((next: SoundProfile) => {
    const prev = liveProfile;
    if (prev) {
      if (next.masterVolume !== prev.masterVolume) {
        volumeAdjustmentsRef.current += 1;
        adaptation.noteVolumeTweak();
      }
      if (soundFingerprint(next) !== soundFingerprint(prev)) {
        customizedRef.current = true;
        // Manual control wins — stop adapting for the rest of the session.
        adaptation.disable();
      }
    }
    setLiveProfile(next);
    engineRef.current?.applyProfile(next);
  });

  const storePreset = (name: string, source: FinishedSession | null) => {
    const profile = source ? source.profile : liveProfile;
    if (!profile) return;
    savePreset({
      id: newId(),
      name,
      createdAt: new Date().toISOString(),
      state: source ? source.state : selection.mentalState,
      intensity: source ? source.intensity : selection.intensity,
      profile: cloneProfile(profile),
    });
    deps.onPresetSaved();
  };

  /**
   * The lab shares the session engine — only reachable with nothing running.
   * Returns false when a session is live; otherwise hands the lab a clean
   * engine (no leftover session evolution or program).
   */
  const prepareLab = (): boolean => {
    const phase = controllerRef.current?.phase;
    if (phase && phase !== 'idle' && phase !== 'finished' && phase !== 'stoppedEarly') {
      return false;
    }
    engineRef.current?.setArcModulation(IDENTITY_MODULATION);
    engineRef.current?.setProgramModulation(null);
    engineRef.current?.setBreathPattern(null);
    return true;
  };

  const releaseLab = () => {
    engineRef.current?.stop();
    engineRef.current?.setProgramModulation(null);
    engineRef.current?.setBreathPattern(null);
    engineRef.current?.setArcModulation(IDENTITY_MODULATION);
  };

  return {
    getEngine: () => engineRef.current,
    getController: () => controllerRef.current,
    ensureEngine,
    liveProfile,
    setLiveProfile,
    starting,
    startError,
    begin,
    stop: () => controllerRef.current?.stop(),
    handleProfileChange,
    storePreset,
    getLastSession: () => lastSessionRef.current,
    getSessionProgram: () => sessionProgramRef.current,
    getSessionBreathing: () => sessionBreathingRef.current,
    prepareLab,
    releaseLab,
    setMonoMode: (mono: boolean) => engineRef.current?.setMonoMode(mono),
  };
}

export type SessionOrchestrator = ReturnType<typeof useSessionOrchestrator>;
