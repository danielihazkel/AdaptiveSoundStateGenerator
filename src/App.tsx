import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ADAPT_INTERVAL_SEC,
  decideAdaptation,
  END_GUARD_SEC,
  PROMPT_TIMEOUT_SEC,
  softenProfile,
} from './adaptation/adaptation';
import type { CheckpointResponse } from './adaptation/types';
import { AudioEngine } from './audio/engine';
import { ADAPT_RAMP_TIME_CONSTANT } from './audio/ramp';
import { STATES, type MentalState } from './audio/states';
import { probeSampleAssets } from './audio/ambienceAssets';
import {
  cloneProfile,
  normalizeProfile,
  type SampleAmbienceType,
  type SoundProfile,
} from './audio/types';
import type { ExportSelection } from './export/offlineRenderer';
import { useMp3Export } from './export/useMp3Export';
import { playSilentKeepAlive } from './platform/silentAudio';
import { useSessionPlatform } from './platform/useSessionPlatform';
import { programMinDurationSec, type Program } from './programs/types';
import { IDENTITY_MODULATION } from './session/evolution';
import { computeHrTrend } from './biometrics/hrTrend';
import { SimulatedHeartRateSource } from './biometrics/simulatedHr';
import {
  isWebBluetoothAvailable,
  type BiometricSample,
  type BiometricSource,
  type BiometricStatus,
} from './biometrics/types';
import { WebBluetoothHeartRateSource } from './biometrics/webBluetoothHr';
import { COACH_CONFIDENCE_THRESHOLD, coachPlan } from './coach/mapToSession';
import { ruleCoachProvider } from './coach/ruleParser';
import {
  COLD_START_SESSIONS,
  eligibleSessionCount,
} from './personalization/bandit';
import {
  buildCandidateProfile,
  CANDIDATE_SET_VERSION,
} from './personalization/candidates';
import {
  computeInsights,
  MIN_SESSIONS_FOR_INSIGHTS,
} from './personalization/insights';
import { findPendingMorningPrompt } from './personalization/morningPrompt';
import {
  chooseProfile,
  resolveOutcome,
  resolvePendingOutcomes,
  type ServedProfile,
} from './personalization/personalizer';
import {
  SessionController,
  type CheckpointInfo,
  type SessionResult,
} from './session/sessionController';
import { useSession } from './session/useSession';
import {
  appendSession,
  attachFeedback,
  deletePreset,
  deleteProgram,
  loadPersonalization,
  loadPresets,
  loadPrograms,
  loadSessions,
  loadSettings,
  markFeedbackSkipped,
  newId,
  savePreset,
  saveProgram,
  saveSettings,
} from './storage/storage';
import {
  modeFor,
  type PersonalizationMode,
  type Preset,
  type Rating,
  type SessionRecord,
  type SessionSegment,
  type Settings,
} from './storage/types';
import { BiometricsPanel } from './ui/BiometricsPanel';
import { CoachInput } from './ui/CoachInput';
import { DataPanel } from './ui/DataPanel';
import { FeedbackScreen } from './ui/FeedbackScreen';
import { InsightsScreen } from './ui/InsightsScreen';
import { MorningPromptModal } from './ui/MorningPrompt';
import { DisclaimerModal, FooterDisclaimer } from './ui/SafetyNotices';
import { LabScreen } from './ui/lab/LabScreen';
import { ProgramEditor } from './ui/ProgramEditor';
import { SessionScreen } from './ui/SessionScreen';
import { SetupScreen } from './ui/SetupScreen';

type Screen = 'setup' | 'session' | 'feedback' | 'insights' | 'programEditor' | 'lab';

interface FinishedSession {
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

function SessionView(props: {
  controller: SessionController;
  mentalState: MentalState;
  program?: Program;
  profile: SoundProfile;
  onProfileChange: (next: SoundProfile) => void;
  onStop: () => void;
  onSavePreset: (name: string) => void;
  availableSampleTypes?: ReadonlySet<SampleAmbienceType>;
  microPrompt?: {
    onRespond: (response: CheckpointResponse) => void;
    onDismiss: () => void;
  };
}) {
  const snapshot = useSession(props.controller);
  const stateDef = STATES[props.mentalState];
  const durationSec = snapshot.elapsedSec + snapshot.remainingSec;
  useSessionPlatform(props.controller, snapshot, {
    title: `${stateDef.label} · ${Math.round(durationSec / 60)} min`,
    subtitle: props.program ? `Resonance · ${props.program.name}` : undefined,
    durationSec,
  });
  return (
    <SessionScreen
      stateDef={STATES[props.mentalState]}
      snapshot={snapshot}
      program={props.program}
      profile={props.profile}
      onProfileChange={props.onProfileChange}
      onPause={() => void props.controller.pause()}
      onResume={() => void props.controller.resume()}
      onStop={props.onStop}
      onSavePreset={props.onSavePreset}
      availableSampleTypes={props.availableSampleTypes}
      microPrompt={props.microPrompt}
    />
  );
}

export function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  const controllerRef = useRef<SessionController | null>(null);
  const customizedRef = useRef(false);
  const volumeAdjustmentsRef = useRef(0);
  const lastSessionRef = useRef<FinishedSession | null>(null);
  /** What the personalizer served for the running session (null for presets). */
  const servedRef = useRef<ServedProfile | null>(null);

  // --- Phase 3 adaptation loop (PRD §17). All refs so the checkpoint
  // callbacks (assigned once per session) never see stale state.
  const sessionMetaRef = useRef<{
    state: MentalState;
    intensity: number;
    mode: PersonalizationMode;
    coachUsed: boolean;
  } | null>(null);
  /** Per-arm timeline; a new segment is closed/opened at every checkpoint. */
  const segmentsRef = useRef<SessionSegment[]>([]);
  /** Master-volume tweaks since the current segment opened. */
  const segmentVolumeTweaksRef = useRef(0);
  /** Set once the user touches the advanced panel — stop adapting for good. */
  const adaptationDisabledRef = useRef(false);
  const switchesRef = useRef(0);
  const softenedRef = useRef(false);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Setup was filled by the coach (PRD §11); consumed by the next begin(). */
  const coachAppliedRef = useRef(false);

  // --- Phase 3 biometrics (PRD §17; consent per §14). Raw samples stay in
  // memory only, bounded, reset per session.
  const biometricSourceRef = useRef<BiometricSource | null>(null);
  const hrSamplesRef = useRef<BiometricSample[]>([]);
  const hrUnsubscribeRef = useRef<(() => void) | null>(null);
  /** Any sample arrived during the running session. */
  const biometricsUsedRef = useRef(false);

  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).has('lab') ? 'lab' : 'setup',
  );
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [programs, setPrograms] = useState<Program[]>(() => loadPrograms());
  /** Draft under edit in the program editor screen. */
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  /** Program driving the currently running session, if any. */
  const sessionProgramRef = useRef<Program | null>(null);
  const [morningPrompt, setMorningPrompt] = useState<SessionRecord | null>(null);
  /** Bumped whenever stored sessions/personalization change, to refresh memos. */
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = () => setDataVersion((v) => v + 1);

  const [mentalState, setMentalState] = useState<MentalState>('focus');
  const [intensity, setIntensity] = useState(0.5);
  const [minutes, setMinutes] = useState(30);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
  const [selectedProgramId, setSelectedProgramId] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const exporter = useMp3Export();
  const [liveProfile, setLiveProfile] = useState<SoundProfile | null>(null);
  const [microPrompt, setMicroPrompt] = useState<CheckpointInfo | null>(null);
  const [coachMessage, setCoachMessage] = useState<string | null>(null);
  const [bioStatus, setBioStatus] = useState<BiometricStatus>('disconnected');
  /** Sample ambience types with a shipped asset (PRD §6E, post-MVP infra). */
  const [sampleAmbience, setSampleAmbience] = useState<ReadonlySet<SampleAmbienceType>>(
    () => new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    void probeSampleAssets().then((types) => {
      if (!cancelled) setSampleAmbience(types);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Settle any sessions whose rating opportunity has passed (implicit-only),
  // then check whether last night's sleep session needs its morning rating.
  useEffect(() => {
    resolvePendingOutcomes();
    setMorningPrompt(findPendingMorningPrompt(loadSessions(), new Date()));
    bumpData();
  }, []);

  const { activeStates, insightsAvailable } = useMemo(() => {
    void dataVersion; // memo key: stored data changed
    const personalization = loadPersonalization(CANDIDATE_SET_VERSION);
    const counts = new Map<MentalState, number>();
    for (const s of loadSessions()) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
    const active = new Set<MentalState>();
    for (const state of Object.keys(STATES) as MentalState[]) {
      if (eligibleSessionCount(personalization, state) >= COLD_START_SESSIONS) {
        active.add(state);
      }
    }
    return {
      activeStates: active,
      insightsAvailable: [...counts.values()].some(
        (c) => c >= MIN_SESSIONS_FOR_INSIGHTS,
      ),
    };
  }, [dataVersion]);

  const insights = useMemo(
    () =>
      screen === 'insights'
        ? computeInsights(loadSessions(), loadPersonalization(CANDIDATE_SET_VERSION))
        : [],
    [screen, dataVersion],
  );

  const updateSettings = (change: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...change };
      saveSettings(next);
      return next;
    });
  };

  const clearMicroPrompt = () => {
    clearTimeout(promptTimerRef.current);
    setMicroPrompt(null);
  };

  /**
   * Close the current segment at a checkpoint, decide, and act (PRD §17).
   * Adaptation-driven profile changes deliberately bypass handleProfileChange
   * so volumeAdjustmentsRef/customizedRef stay pure user signals.
   */
  const runAdaptation = (response: CheckpointResponse | null, info: CheckpointInfo) => {
    const meta = sessionMetaRef.current;
    const engine = engineRef.current;
    const controller = controllerRef.current;
    const segments = segmentsRef.current;
    const current = segments[segments.length - 1];
    if (!meta || !engine || !controller || !current) return;

    const hr = computeHrTrend(hrSamplesRef.current, {
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
    });
    segmentVolumeTweaksRef.current = 0;

    if (action.kind === 'switch' || action.kind === 'revert') {
      const next = buildCandidateProfile(meta.state, meta.intensity, action.armId);
      // Never stomp the user's live volume (their safety/comfort control).
      next.masterVolume = engine.getProfile().masterVolume;
      controller.applyProfile(next, ADAPT_RAMP_TIME_CONSTANT);
      setLiveProfile(next);
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
        setLiveProfile(next);
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

  const handleCheckpoint = (info: CheckpointInfo) => {
    const meta = sessionMetaRef.current;
    if (!meta || !servedRef.current || adaptationDisabledRef.current) return;
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

  const handlePromptAnswer = (response: CheckpointResponse | null) => {
    const info = microPrompt;
    clearMicroPrompt();
    if (info) runAdaptation(response, info);
  };

  const handleComplete = (result: SessionResult) => {
    clearMicroPrompt();
    const engine = engineRef.current;
    const profile = engine?.getProfile() ?? result.config.profile;
    const served = servedRef.current;

    // Persist the segment timeline only for sessions that actually adapted or
    // answered a check-in — plain sessions keep the legacy single-arm shape.
    let segments: SessionSegment[] | undefined;
    if (served && segmentsRef.current.length > 0) {
      const finalized = segmentsRef.current.map((s) => ({ ...s }));
      const last = finalized[finalized.length - 1];
      last.endSec = result.actualDurationSec;
      last.volumeAdjustments = segmentVolumeTweaksRef.current;
      const adapted =
        finalized.some((s) => s.response !== undefined) ||
        new Set(finalized.map((s) => s.armId)).size > 1 ||
        softenedRef.current;
      if (adapted) segments = finalized;
    }
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
      programId: result.config.program?.id,
      profile,
      // The arm id travels in the record so the reward lands on the right arm
      // even if the app reloads before the rating arrives.
      servedArmId: served?.armId,
      servedBy: result.config.presetId ? 'preset' : served?.servedBy,
      segments,
      coachUsed: sessionMetaRef.current?.coachUsed || undefined,
      biometricsUsed: biometricsUsedRef.current || undefined,
    };
    appendSession(record);
    bumpData();
    sessionProgramRef.current = null;
    lastSessionRef.current = {
      recordId: record.id,
      state: record.state,
      intensity: record.intensity,
      profile,
      completed: record.completed,
    };
    // A completed sleep session gets no rating prompt — the user is asleep
    // (PRD §9; the next-morning prompt arrives with Phase 2 personalization).
    if (record.completed && record.state === 'sleep') {
      setScreen('setup');
    } else {
      setScreen('feedback');
    }
  };

  // Closing the tab mid-session drops the session record; mid-export it
  // drops the render. Ask first.
  const guardUnload = screen === 'session' || exporter.progress !== null;
  useEffect(() => {
    if (!guardUnload) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guardUnload]);

  // Release the audio graph and timers if the app root ever unmounts.
  useEffect(
    () => () => {
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
      controller.onComplete = handleComplete;
      controllerRef.current = controller;
    }
    return engineRef.current;
  };

  /**
   * The sound the Download button would export — same precedence as begin()
   * (program > preset > personalized), but served deterministically
   * ('locked' = best known arm): a download must not create a session record
   * or feed the bandit, and re-downloading should yield the same sound.
   */
  const resolveExportSelection = (): { sel: ExportSelection; label: string } => {
    const program = programs.find((p) => p.id === selectedProgramId);
    const preset = program
      ? undefined
      : presets.find((p) => p.id === selectedPresetId && p.state === mentalState);
    const chimeEnabled = settings.chimeEnabled;
    if (program) {
      return {
        sel: {
          profile: normalizeProfile(program.baseProfile),
          state: program.baseState,
          durationSec: Math.max(minutes * 60, programMinDurationSec(program)),
          program,
          chimeEnabled,
        },
        label: program.name,
      };
    }
    if (preset) {
      return {
        sel: {
          profile: cloneProfile(preset.profile),
          state: mentalState,
          durationSec: minutes * 60,
          program: null,
          chimeEnabled,
        },
        label: preset.name,
      };
    }
    const served = chooseProfile(mentalState, intensity, 'locked');
    return {
      sel: {
        profile: served.profile,
        state: mentalState,
        durationSec: minutes * 60,
        program: null,
        chimeEnabled,
      },
      label: mentalState,
    };
  };

  const handleDownload = () => {
    const { sel, label } = resolveExportSelection();
    void exporter.start(sel, label);
  };

  const begin = async () => {
    if (starting) return;
    // Synchronously inside the tap: iOS only starts media from a gesture, and
    // the keep-alive is what lets the session survive a locked screen.
    playSilentKeepAlive();
    setStarting(true);
    try {
      const program = programs.find((p) => p.id === selectedProgramId);
      const preset = program
        ? undefined
        : presets.find((p) => p.id === selectedPresetId && p.state === mentalState);
      let profile: SoundProfile;
      if (program) {
        // Program sessions play the program's snapshot; like presets they
        // bypass the bandit entirely.
        profile = normalizeProfile(program.baseProfile);
        servedRef.current = null;
      } else if (preset) {
        profile = cloneProfile(preset.profile);
        servedRef.current = null;
      } else {
        const served = chooseProfile(
          mentalState,
          intensity,
          modeFor(settings, mentalState),
        );
        profile = served.profile;
        servedRef.current = served;
      }
      sessionProgramRef.current = program ?? null;

      await ensureEngine(profile);
      customizedRef.current = false;
      volumeAdjustmentsRef.current = 0;

      const sessionState = program ? program.baseState : mentalState;
      const sessionIntensity = program
        ? program.baseIntensity
        : preset
          ? preset.intensity
          : intensity;
      sessionMetaRef.current = {
        state: sessionState,
        intensity: sessionIntensity,
        mode: modeFor(settings, sessionState),
        coachUsed: coachAppliedRef.current,
      };
      coachAppliedRef.current = false;
      setCoachMessage(null);
      segmentsRef.current = servedRef.current
        ? [
            {
              armId: servedRef.current.armId,
              startSec: 0,
              endSec: 0,
              volumeAdjustments: 0,
              trigger: 'initial',
            },
          ]
        : [];
      segmentVolumeTweaksRef.current = 0;
      adaptationDisabledRef.current = false;
      switchesRef.current = 0;
      softenedRef.current = false;
      hrSamplesRef.current = [];
      biometricsUsedRef.current = false;
      clearMicroPrompt();
      controllerRef.current!.onCheckpoint = handleCheckpoint;

      // Presets adapt away from the exact sound the user chose — never do
      // that. The toggle turns checkpoints off entirely. Program sessions
      // never adapt either (v1): the program owns the session's shape.
      const adaptationOn = !preset && !program && settings.adaptationEnabled !== false;
      // A program's closed phases must all play out; extra time extends the
      // open-ended final phase.
      const durationSec = program
        ? Math.max(minutes * 60, programMinDurationSec(program))
        : minutes * 60;
      setLiveProfile(profile);
      await controllerRef.current!.start({
        state: sessionState,
        intensity: sessionIntensity,
        durationSec,
        profile,
        presetId: preset?.id,
        program,
        chimeEnabled: settings.chimeEnabled,
        checkpointSec: adaptationOn ? ADAPT_INTERVAL_SEC : undefined,
        endGuardSec: END_GUARD_SEC,
      });
      setScreen('session');
    } finally {
      setStarting(false);
    }
  };

  const handleProfileChange = (next: SoundProfile) => {
    const prev = liveProfile;
    if (prev) {
      if (next.masterVolume !== prev.masterVolume) {
        volumeAdjustmentsRef.current += 1;
        segmentVolumeTweaksRef.current += 1;
      }
      if (soundFingerprint(next) !== soundFingerprint(prev)) {
        customizedRef.current = true;
        // Manual control wins — stop adapting for the rest of the session.
        adaptationDisabledRef.current = true;
        clearMicroPrompt();
      }
    }
    setLiveProfile(next);
    engineRef.current?.applyProfile(next);
  };

  const handleCoach = async (text: string) => {
    const interpretation = await ruleCoachProvider.interpret(text);
    const plan =
      interpretation.confidence >= COACH_CONFIDENCE_THRESHOLD
        ? coachPlan(interpretation.request)
        : null;
    if (!plan) {
      // Keep whatever *was* understood (usually a duration) and fall back.
      if (interpretation.request.durationMin) {
        setMinutes(interpretation.request.durationMin);
      }
      setCoachMessage("I couldn't quite tell what you're after — pick a state below.");
      return;
    }
    setMentalState(plan.state);
    setIntensity(plan.intensity);
    setMinutes(plan.minutes);
    setSelectedPresetId(undefined);
    coachAppliedRef.current = true;
    const def = STATES[plan.state];
    const depth =
      plan.intensity < 0.4
        ? def.intensityLabels[0].toLowerCase()
        : plan.intensity > 0.6
          ? def.intensityLabels[1].toLowerCase()
          : 'balanced';
    setCoachMessage(
      `${def.emoji} ${def.label} · ${depth} · ${plan.minutes} min — press Begin when ready.`,
    );
  };

  /** Dev-only simulated sensor: open the app with ?simhr (rising trend). */
  const simulatedHr = useMemo(
    () => new URLSearchParams(window.location.search).has('simhr'),
    [],
  );
  const biometricsPossible = simulatedHr || isWebBluetoothAvailable();
  /** In-memory sample cap ≈ 2h at 1 Hz — plenty for any session's windows. */
  const HR_SAMPLE_CAP = 7200;

  const connectBiometrics = async () => {
    if (!biometricSourceRef.current) {
      const source: BiometricSource = simulatedHr
        ? new SimulatedHeartRateSource({ driftPerMin: 2 })
        : new WebBluetoothHeartRateSource();
      source.onStatusChange = setBioStatus;
      biometricSourceRef.current = source;
    }
    const source = biometricSourceRef.current;
    try {
      await source.connect();
    } catch {
      return; // user cancelled the chooser or the strap refused — status shows it
    }
    hrUnsubscribeRef.current?.();
    hrUnsubscribeRef.current = source.subscribe((sample) => {
      const buffer = hrSamplesRef.current;
      buffer.push(sample);
      if (buffer.length > HR_SAMPLE_CAP) buffer.splice(0, buffer.length - HR_SAMPLE_CAP);
      biometricsUsedRef.current = true;
    });
  };

  const storePreset = (name: string, source: FinishedSession | null) => {
    const profile = source ? source.profile : liveProfile;
    if (!profile) return;
    savePreset({
      id: newId(),
      name,
      createdAt: new Date().toISOString(),
      state: source ? source.state : mentalState,
      intensity: source ? source.intensity : intensity,
      profile: cloneProfile(profile),
    });
    setPresets(loadPresets());
  };

  /** The lab shares the session engine — only reachable with nothing running. */
  const openLab = () => {
    const phase = controllerRef.current?.phase;
    if (phase && phase !== 'idle' && phase !== 'finished' && phase !== 'stoppedEarly') {
      return;
    }
    // Hand the lab a clean engine: no leftover session evolution or program.
    engineRef.current?.setArcModulation(IDENTITY_MODULATION);
    engineRef.current?.setProgramModulation(null);
    setScreen('lab');
  };

  const closeLab = () => {
    engineRef.current?.stop();
    engineRef.current?.setProgramModulation(null);
    engineRef.current?.setArcModulation(IDENTITY_MODULATION);
    setScreen('setup');
  };

  const handleSaveProgram = (program: Program) => {
    saveProgram(program);
    setPrograms(loadPrograms());
    setSelectedProgramId(program.id);
    setSelectedPresetId(undefined);
    setMentalState(program.baseState);
    setEditingProgram(null);
    setScreen('setup');
  };

  const handleRate = (rating: Rating) => {
    const last = lastSessionRef.current;
    if (last) {
      attachFeedback(last.recordId, rating);
      resolveOutcome(last.recordId);
      bumpData();
    }
    setScreen('setup');
  };

  const handleSkipFeedback = () => {
    const last = lastSessionRef.current;
    if (last) {
      markFeedbackSkipped(last.recordId);
      resolveOutcome(last.recordId);
      bumpData();
    }
    setScreen('setup');
  };

  const handleMorningRate = (rating: Rating) => {
    if (morningPrompt) {
      attachFeedback(morningPrompt.id, rating);
      resolveOutcome(morningPrompt.id);
      bumpData();
    }
    setMorningPrompt(null);
  };

  const handleMorningDismiss = () => {
    if (morningPrompt) {
      markFeedbackSkipped(morningPrompt.id);
      resolveOutcome(morningPrompt.id);
      bumpData();
    }
    setMorningPrompt(null);
  };

  return (
    <main className="app">
      {!settings.disclaimerAcknowledgedAt && (
        <DisclaimerModal
          onAcknowledge={() =>
            updateSettings({ disclaimerAcknowledgedAt: new Date().toISOString() })
          }
        />
      )}

      {settings.disclaimerAcknowledgedAt && morningPrompt && screen === 'setup' && (
        <MorningPromptModal
          onRate={handleMorningRate}
          onDismiss={handleMorningDismiss}
        />
      )}

      <h1>Resonance</h1>
      <p className="subtitle">Generated sound for the state you want.</p>

      {screen === 'setup' && (
        <CoachInput onSubmit={(text) => void handleCoach(text)} message={coachMessage} />
      )}

      {screen === 'setup' && (
        <SetupScreen
          state={mentalState}
          intensity={intensity}
          minutes={minutes}
          presets={presets}
          selectedPresetId={selectedPresetId}
          programs={programs}
          selectedProgramId={selectedProgramId}
          monoMode={settings.monoMode}
          chimeEnabled={settings.chimeEnabled}
          adaptationEnabled={settings.adaptationEnabled !== false}
          starting={starting}
          onStateChange={(s) => {
            setMentalState(s);
            setSelectedPresetId(undefined);
            setSelectedProgramId(undefined);
            // Picking a state manually overrides whatever the coach set up.
            coachAppliedRef.current = false;
            setCoachMessage(null);
          }}
          onIntensityChange={(v) => {
            setIntensity(v);
            setSelectedPresetId(undefined);
          }}
          onMinutesChange={setMinutes}
          onSelectPreset={(preset) => {
            setSelectedPresetId(preset?.id);
            if (preset) {
              setIntensity(preset.intensity);
              setSelectedProgramId(undefined);
            }
          }}
          onDeletePreset={(id) => {
            deletePreset(id);
            setPresets(loadPresets());
            if (selectedPresetId === id) setSelectedPresetId(undefined);
          }}
          onSelectProgram={(program) => {
            setSelectedProgramId(program?.id);
            if (program) {
              setSelectedPresetId(undefined);
              // The program owns the base sound — keep the visible state in
              // sync so warnings and end behavior read correctly.
              setMentalState(program.baseState);
            }
          }}
          onDeleteProgram={(id) => {
            deleteProgram(id);
            setPrograms(loadPrograms());
            if (selectedProgramId === id) setSelectedProgramId(undefined);
          }}
          onNewProgram={(template) => {
            setEditingProgram(template.build(mentalState, intensity));
            setScreen('programEditor');
          }}
          onEditProgram={(program) => {
            setEditingProgram(program);
            setScreen('programEditor');
          }}
          onOpenLab={openLab}
          onToggleMono={(mono) => {
            updateSettings({ monoMode: mono });
            engineRef.current?.setMonoMode(mono);
          }}
          onToggleChime={(chime) => updateSettings({ chimeEnabled: chime })}
          onToggleAdaptation={(enabled) => updateSettings({ adaptationEnabled: enabled })}
          personalizationActive={activeStates.has(mentalState)}
          personalizationMode={modeFor(settings, mentalState)}
          insightsAvailable={insightsAvailable}
          onModeChange={(mode) =>
            updateSettings({
              personalizationMode: {
                ...settings.personalizationMode,
                [mentalState]: mode,
              },
            })
          }
          onShowInsights={() => setScreen('insights')}
          onBegin={() => void begin()}
          exporter={exporter}
          onDownload={handleDownload}
        />
      )}

      {screen === 'setup' && biometricsPossible && (
        <BiometricsPanel
          status={bioStatus}
          consented={Boolean(settings.biometricsConsentAt)}
          simulated={simulatedHr}
          onConsent={(consented) =>
            updateSettings({
              biometricsConsentAt: consented ? new Date().toISOString() : null,
            })
          }
          onConnect={() => void connectBiometrics()}
          onDisconnect={() => biometricSourceRef.current?.disconnect()}
        />
      )}

      {screen === 'setup' && (
        <DataPanel
          onImported={() => {
            setPresets(loadPresets());
            setSettings(loadSettings());
            bumpData();
          }}
        />
      )}

      {screen === 'insights' && (
        <InsightsScreen insights={insights} onBack={() => setScreen('setup')} />
      )}

      {screen === 'programEditor' && editingProgram && (
        <ProgramEditor
          program={editingProgram}
          exporter={exporter}
          chimeEnabled={settings.chimeEnabled}
          onSave={handleSaveProgram}
          onCancel={() => {
            setEditingProgram(null);
            setScreen('setup');
          }}
        />
      )}

      {screen === 'lab' && (
        <LabScreen
          ensureEngine={ensureEngine}
          getEngine={() => engineRef.current}
          presets={presets}
          programs={programs}
          exporter={exporter}
          chimeEnabled={settings.chimeEnabled}
          availableSampleTypes={sampleAmbience}
          onSavePreset={(name, profile, state, labIntensity) => {
            savePreset({
              id: newId(),
              name,
              createdAt: new Date().toISOString(),
              state,
              intensity: labIntensity,
              profile,
            });
            setPresets(loadPresets());
          }}
          onBack={closeLab}
        />
      )}

      {screen === 'session' && controllerRef.current && liveProfile && (
        <SessionView
          controller={controllerRef.current}
          mentalState={sessionMetaRef.current?.state ?? mentalState}
          program={sessionProgramRef.current ?? undefined}
          profile={liveProfile}
          onProfileChange={handleProfileChange}
          onStop={() => controllerRef.current?.stop()}
          onSavePreset={(name) => storePreset(name, null)}
          availableSampleTypes={sampleAmbience}
          microPrompt={
            microPrompt
              ? {
                  onRespond: (response) => handlePromptAnswer(response),
                  onDismiss: () => handlePromptAnswer(null),
                }
              : undefined
          }
        />
      )}

      {screen === 'feedback' && lastSessionRef.current && (
        <FeedbackScreen
          stateLabel={STATES[lastSessionRef.current.state].label}
          completed={lastSessionRef.current.completed}
          onRate={handleRate}
          onSkip={handleSkipFeedback}
          onSavePreset={(name) => storePreset(name, lastSessionRef.current)}
        />
      )}

      <FooterDisclaimer />
    </main>
  );
}
