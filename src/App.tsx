import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { STATES } from './audio/states';
import { moodBucketOf, timeBucketOf } from './personalization/context';
import { describeServedSound } from './personalization/personalizer';
import { resolveSetupExport } from './export/setupExport';
import { useMp3Export } from './export/useMp3Export';
import type { Program } from './programs/types';
import type { Routine } from './routines/types';
import { RoutinesPanel } from './ui/RoutinesPanel';
import {
  deletePreset,
  deleteProgram,
  deleteRoutine,
  movePresetInList,
  newId,
  renamePreset,
  savePreset,
  saveProgram,
  saveRoutine,
  setPresetFavorite,
} from './storage/storage';
import type { SharePayload } from './share/shareLink';
import { DEFAULT_WAKE_UP, modeFor, type MoodLevel, type Theme } from './storage/types';
import { nightstandFor } from './session/sessionOptions';
import { BiometricsPanel, MotionPanel, SleepOnsetToggle } from './ui/BiometricsPanel';
import { CoachInput } from './ui/CoachInput';
import { DataPanel } from './ui/DataPanel';
import { FeedbackScreen } from './ui/FeedbackScreen';
import { MorningPromptModal } from './ui/MorningPrompt';
import { OnboardingTour } from './ui/OnboardingTour';
import { shouldAutoCompleteTour, shouldShowTour } from './ui/onboarding';
import { DisclaimerModal, FooterDisclaimer } from './ui/SafetyNotices';
import { SetupScreen } from './ui/SetupScreen';
import { SessionView } from './app/SessionView';
import { setReloadBusy } from './app/reloadGate';
import type { Screen } from './app/types';
import { importSharePayload } from './app/importShare';
import { screenForHash } from './app/router';
import { useHashScreen } from './app/useHashScreen';
import { useAdaptationLoop } from './app/useAdaptationLoop';
import { useBiometrics } from './app/useBiometrics';
import { useMotion } from './app/useMotion';
import { useCoach } from './app/useCoach';
import { useFeedbackHandlers } from './app/useFeedbackHandlers';
import {
  useSessionOrchestrator,
  type SessionOrchestrator,
} from './app/useSessionOrchestrator';
import { useSetupSelection } from './app/useSetupSelection';
import { useStoredData } from './app/useStoredData';
import { useQuickStart } from './app/useQuickStart';
import { useShareImport } from './app/useShareImport';
import { useTabGuard } from './app/useTabGuard';
import { useStableCallback } from './app/useStableCallback';
import { ShareImportModal } from './ui/ShareImportModal';
import { ErrorBoundary, reloadForChunkError } from './ui/ErrorBoundary';
import { UpdateToast } from './ui/UpdateToast';
import { clearAppError, getAppError, subscribeAppErrors } from './app/appErrors';

// Power-user screens load on demand so the first paint (setup → session)
// doesn't carry the lab, editor, history, and insights code.
const HistoryScreen = lazy(() =>
  import('./ui/HistoryScreen').then((m) => ({ default: m.HistoryScreen })),
);
const InsightsScreen = lazy(() =>
  import('./ui/InsightsScreen').then((m) => ({ default: m.InsightsScreen })),
);
const LabScreen = lazy(() => import('./ui/lab/LabScreen').then((m) => ({ default: m.LabScreen })));
const ProgramEditor = lazy(() =>
  import('./ui/ProgramEditor').then((m) => ({ default: m.ProgramEditor })),
);
const SettingsScreen = lazy(() =>
  import('./ui/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);
const RoutineEditor = lazy(() =>
  import('./ui/RoutineEditor').then((m) => ({ default: m.RoutineEditor })),
);

const SCREEN_LOADING = (
  <p className="hint" role="status">
    Loading…
  </p>
);

const STORAGE_NOTICES = {
  write:
    "Couldn't save to this device's storage (it may be full). Your session history may not be recorded — export your data from Settings → “Your data” to keep it safe.",
  incompatible:
    'Some saved data was written by a newer version of Resonance and has been kept aside untouched. Update the app to see it again.',
  corrupt:
    'Some saved data on this device was damaged and has been set aside. Everything else is intact.',
} as const;

/** Background the browser chrome should match per resolved theme (index.css --bg). */
const THEME_COLOR = { dark: '#12141a', light: '#f5f6fa' } as const;

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const resolved =
    theme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[resolved]);
}

/** `?lab` opens the lab directly; otherwise the hash names the screen. The editors need a draft, so they can't be landing screens. */
function initialScreen(): Screen {
  if (new URLSearchParams(window.location.search).has('lab')) return 'lab';
  const fromHash = screenForHash(window.location.hash);
  return fromHash && fromHash !== 'programEditor' && fromHash !== 'routineEditor' ? fromHash : 'setup';
}

/**
 * Screen routing and wiring. The behavior lives in src/app/: stored data,
 * setup selection, the coach, biometrics, the adaptation loop, and the
 * session orchestrator that owns the audio engine.
 */
export function App() {
  /** Draft under edit in the program editor screen. */
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  // Mirrors the draft synchronously so a navigation issued in the same tick
  // as `setEditingProgram` (open editor) sees it.
  const editingProgramRef = useRef<Program | null>(null);
  const setDraft = (program: Program | null) => {
    editingProgramRef.current = program;
    setEditingProgram(program);
  };
  /** Draft under edit in the routine editor (same synchronous-mirror pattern). */
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const editingRoutineRef = useRef<Routine | null>(null);
  const setRoutineDraft = (routine: Routine | null) => {
    editingRoutineRef.current = routine;
    setEditingRoutine(routine);
  };
  // The orchestrator and the adaptation loop reference each other; the loop
  // reaches the orchestrator through a ref that is synced after each commit
  // (never written during render), and only ever dereferences it at call
  // time (checkpoints). The screen transition guard reads it the same way.
  const sessionRef = useRef<SessionOrchestrator | null>(null);
  const { screen, navigate } = useHashScreen({
    initial: initialScreen,
    // Every screen change — app button or browser Back — passes through here,
    // so leaving the lab or the editor cleans up the same way either way.
    transition: (from, to) => {
      if (from === 'lab') sessionRef.current?.releaseLab();
      if (from === 'programEditor') setDraft(null);
      if (from === 'routineEditor') setRoutineDraft(null);
      if (to === 'lab' && !sessionRef.current?.prepareLab()) return false;
      if (to === 'programEditor' && !editingProgramRef.current) return false;
      if (to === 'routineEditor' && !editingRoutineRef.current) return false;
      return true;
    },
  });

  const data = useStoredData(screen);
  const { settings, updateSettings, presets, programs } = data;
  const coach = useCoach();
  const selection = useSetupSelection({ onUserOverride: coach.reset });
  const biometrics = useBiometrics();
  const motion = useMotion();
  const exporter = useMp3Export({
    options: settings.export,
    onOptionsChange: (next) => updateSettings({ export: next }),
  });
  const tabGuard = useTabGuard();
  const share = useShareImport();
  useQuickStart(selection, data.sessionsLoaded);

  // Theme: explicit choice stamps data-theme; 'system' leaves it to the OS.
  const theme = settings.theme ?? 'system';
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  // Screens are conditionally rendered (the hash only mirrors them) — move
  // focus to the heading on each change so keyboard and screen-reader users
  // land at the top of the new screen instead of on a vanished button.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [screen]);

  const adaptation = useAdaptationLoop({
    getEngine: () => sessionRef.current?.getEngine() ?? null,
    getController: () => sessionRef.current?.getController() ?? null,
    getHrSamples: biometrics.getSamples,
    getMotionSamples: motion.getSamples,
    setLiveProfile: (profile) => sessionRef.current?.setLiveProfile(profile),
  });
  const session = useSessionOrchestrator({
    settings,
    selection,
    presets,
    programs,
    adaptation,
    biometrics,
    motion,
    coach,
    onSessionStored: data.bumpData,
    onPresetSaved: data.refreshPresets,
    onFinished: navigate,
    onSessionStarted: () => navigate('session'),
  });
  useLayoutEffect(() => {
    sessionRef.current = session;
  });
  const feedback = useFeedbackHandlers({
    getLastSession: session.getLastSession,
    morningPrompt: data.morningPrompt,
    setMorningPrompt: data.setMorningPrompt,
    bumpData: data.bumpData,
    onDone: () => navigate('setup'),
  });

  // First-run tour: new users see it once after the disclaimer; anyone with
  // sessions already predates it and just gets it marked as seen. Settings
  // can ask for it again.
  const [tourReplay, setTourReplay] = useState(false);
  /** Phase 13: the optional "how do you feel right now?" answer for the next Begin. */
  const [moodBefore, setMoodBefore] = useState<MoodLevel | undefined>(undefined);
  const showTour =
    screen === 'setup' &&
    (tourReplay || (data.sessionsLoaded && shouldShowTour(settings, data.historyAvailable)));
  useEffect(() => {
    if (data.sessionsLoaded && shouldAutoCompleteTour(settings, data.historyAvailable)) {
      updateSettings({ onboardingCompletedAt: new Date().toISOString() });
    }
  }, [settings, data.historyAvailable, data.sessionsLoaded, updateSettings]);

  // Closing the tab mid-session drops the session record; mid-export it
  // drops the render. Ask first.
  const appError = useSyncExternalStore(subscribeAppErrors, getAppError, getAppError);
  const guardUnload = screen === 'session' || exporter.progress !== null;
  // A waiting service-worker update reloads only once this goes false.
  useEffect(() => {
    setReloadBusy(guardUnload);
  }, [guardUnload]);
  useEffect(() => {
    if (!guardUnload) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guardUnload]);

  const handleDownload = () => {
    const { sel, label } = resolveSetupExport({
      programs,
      presets,
      selectedProgramId: selection.selectedProgramId,
      selectedPresetId: selection.selectedPresetId,
      state: selection.mentalState,
      intensity: selection.intensity,
      minutes: selection.resolveMinutes(),
      chimeEnabled: settings.chimeEnabled,
      intervals: selection.intervals,
      breathingPattern: settings.breathingPattern,
      wakeUp: settings.wakeUp,
      replay: selection.replay,
    });
    void exporter.start(sel, label);
  };

  const playLast = () => {
    if (!data.lastSession) return;
    // Mirror the selection (so the setup screen reads right if start fails)
    // and start directly from the record inside this same tap gesture.
    selection.replayFrom(data.lastSession);
    void session.begin({ replayOf: data.lastSession });
  };

  const openRoutineEditor = (routine: Routine) => {
    setRoutineDraft(routine);
    navigate('routineEditor');
  };

  const openEditor = (program: Program) => {
    setDraft(program);
    navigate('programEditor');
  };

  const handleSaveProgram = (program: Program) => {
    saveProgram(program);
    data.refreshPrograms();
    selection.selectProgram(program);
    navigate('setup');
  };

  // Links and saved share files land in the same place.
  const importShare = (payload: SharePayload) =>
    importSharePayload(payload, {
      refreshPrograms: data.refreshPrograms,
      refreshPresets: data.refreshPresets,
      selectProgram: selection.selectProgram,
      selectState: selection.selectState,
      selectPreset: selection.selectPreset,
      refreshRoutines: data.refreshRoutines,
    });

  const lastSession = session.getLastSession();
  const controller = session.getController();
  const sessionState = adaptation.getMeta()?.state ?? selection.mentalState;
  // "Why this sound" (Phase 15): recomputed when the served sound or the
  // playing arm changes, not on every volume step.
  const { kind: soundKind, served } = session.getServedInfo();
  const currentArmId = adaptation.getCurrentArmId();
  const sessionMono = session.getEngine()?.isMonoMode ?? settings.monoMode;
  const sessionMood = moodBucketOf(adaptation.getMeta()?.moodBefore);
  const explainOn = screen === 'session' && settings.explainSound !== false;
  const soundExplanation = useMemo(
    () =>
      explainOn
        ? describeServedSound({
            state: sessionState,
            kind: soundKind,
            servedArmId: served?.armId,
            servedBy: served?.servedBy,
            currentArmId: currentArmId ?? undefined,
            ctx: { bucket: timeBucketOf(new Date()), mono: sessionMono, mood: sessionMood },
          })
        : null,
    [explainOn, sessionState, soundKind, served, currentArmId, sessionMono, sessionMood],
  );
  const getAnalyser = useStableCallback(() => session.getEngine()?.attachAnalyser() ?? null);

  return (
    <main className="app">
      {!settings.disclaimerAcknowledgedAt && (
        <DisclaimerModal
          onAcknowledge={() =>
            updateSettings({ disclaimerAcknowledgedAt: new Date().toISOString() })
          }
        />
      )}

      {showTour && (
        <OnboardingTour
          onDone={() => {
            setTourReplay(false);
            updateSettings({ onboardingCompletedAt: new Date().toISOString() });
          }}
        />
      )}

      {settings.disclaimerAcknowledgedAt && !showTour && data.morningPrompt && screen === 'setup' && (
        <MorningPromptModal onRate={feedback.morningRate} onDismiss={feedback.morningDismiss} />
      )}

      {settings.disclaimerAcknowledgedAt && !showTour && !data.morningPrompt && share.pending && screen === 'setup' && (
        <ShareImportModal
          pending={share.pending}
          onDismiss={share.dismiss}
          onImport={(payload) => {
            importShare(payload);
            share.dismiss();
          }}
        />
      )}

      <h1 ref={headingRef} tabIndex={-1}>
        Resonance
      </h1>
      <p className="subtitle">Generated sound for the state you want.</p>

      {data.storageFailure && screen === 'setup' && (
        <div className="notice warning" role="alert">
          <span>{STORAGE_NOTICES[data.storageFailure]}</span>
          <button
            type="button"
            className="chip"
            aria-label="Dismiss storage warning"
            onClick={data.dismissStorageFailure}
          >
            ✕
          </button>
        </div>
      )}

      {appError && screen !== 'session' && (
        <div className="notice warning" role="alert">
          <span>
            {appError.chunkLoad
              ? "Part of the app couldn't be loaded — it may have been updated since you opened it."
              : `Something went wrong in the background (${appError.message}). Your session keeps playing.`}
          </span>
          <span className="toast-actions">
            {appError.chunkLoad && (
              <button type="button" className="chip" onClick={reloadForChunkError}>
                Reload
              </button>
            )}
            <button
              type="button"
              className="chip"
              aria-label="Dismiss error notice"
              onClick={clearAppError}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {data.recoveredSession && screen === 'setup' && (
        <div className="notice" role="status">
          <span>
            Your last {STATES[data.recoveredSession.state].label.toLowerCase()} session ended
            unexpectedly — it has been added to your history.
          </span>
          <button
            type="button"
            className="chip"
            aria-label="Dismiss recovered session notice"
            onClick={data.dismissRecoveredSession}
          >
            ✕
          </button>
        </div>
      )}

      {tabGuard.otherTab && screen === 'setup' && (
        <div className="notice warning" role="alert">
          <span>
            Resonance is already open in another tab. Sessions and saved data can
            conflict — use the other tab, or continue here.
          </span>
          <button
            type="button"
            className="chip"
            aria-label="Dismiss other-tab warning"
            onClick={tabGuard.dismiss}
          >
            ✕
          </button>
        </div>
      )}

      {screen === 'setup' && (
        <CoachInput
          onSubmit={(text) => void coach.submit(text, selection)}
          message={coach.message}
        />
      )}

      {screen === 'setup' && (
        <SetupScreen
          state={selection.mentalState}
          intensity={selection.intensity}
          minutes={selection.minutes}
          endAt={selection.endAt}
          onEndAtChange={selection.setEndAt}
          openEnded={selection.openEnded}
          onOpenEndedChange={selection.setOpenEnded}
          breathingPattern={settings.breathingPattern ?? 'pulse'}
          onBreathingPatternChange={(id) => updateSettings({ breathingPattern: id })}
          wakeUp={settings.wakeUp ?? DEFAULT_WAKE_UP}
          onWakeUpChange={(wakeUp) => updateSettings({ wakeUp })}
          smartWakeAvailable={Boolean(
            (motion.possible && settings.motionConsentAt) ||
              (biometrics.possible && settings.biometricsConsentAt),
          )}
          intervals={selection.intervals}
          onIntervalsChange={selection.setIntervals}
          presets={presets}
          selectedPresetId={selection.selectedPresetId}
          programs={programs}
          selectedProgramId={selection.selectedProgramId}
          monoMode={settings.monoMode}
          chimeEnabled={settings.chimeEnabled}
          starting={session.starting}
          onStateChange={selection.selectState}
          onIntensityChange={selection.setIntensity}
          onMinutesChange={selection.setMinutes}
          onSelectPreset={selection.selectPreset}
          onDeletePreset={(id) => {
            deletePreset(id);
            data.refreshPresets();
            selection.forgetPreset(id);
          }}
          onRenamePreset={(id, name) => {
            renamePreset(id, name);
            data.refreshPresets();
          }}
          onToggleFavoritePreset={(id, favorite) => {
            setPresetFavorite(id, favorite);
            data.refreshPresets();
          }}
          onMovePreset={(id, direction) => {
            movePresetInList(id, direction);
            data.refreshPresets();
          }}
          onSelectProgram={selection.selectProgram}
          onDeleteProgram={(id) => {
            deleteProgram(id);
            data.refreshPrograms();
            selection.forgetProgram(id);
          }}
          onNewProgram={(template) =>
            openEditor(template.build(selection.mentalState, selection.intensity))
          }
          onEditProgram={openEditor}
          onOpenLab={() => navigate('lab')}
          onToggleMono={(mono) => {
            updateSettings({ monoMode: mono });
            session.setMonoMode(mono);
          }}
          onToggleChime={(chime) => updateSettings({ chimeEnabled: chime })}
          onOpenSettings={() => navigate('settings')}
          lastSession={data.lastSession}
          onPlayLast={playLast}
          personalizationActive={data.activeStates.has(selection.mentalState)}
          personalizationMode={modeFor(settings, selection.mentalState)}
          insightsAvailable={data.insightsAvailable}
          historyAvailable={data.historyAvailable}
          replay={selection.replay}
          onClearReplay={selection.clearReplay}
          startError={session.startError}
          onShowHistory={() => navigate('history')}
          onModeChange={(mode) =>
            updateSettings({
              personalizationMode: {
                ...settings.personalizationMode,
                [selection.mentalState]: mode,
              },
            })
          }
          onShowInsights={() => navigate('insights')}
          moodBefore={moodBefore}
          onMoodBeforeChange={setMoodBefore}
          onBegin={() => {
            // The answer belongs to this one session.
            void session.begin({ moodBefore });
            setMoodBefore(undefined);
          }}
          exporter={exporter}
          onDownload={handleDownload}
        />
      )}

      {screen === 'setup' && (
        <RoutinesPanel
          routines={data.routines}
          starting={session.starting}
          onStart={(routine) => void session.beginRoutine(routine)}
          onEdit={openRoutineEditor}
          onNew={() =>
            openRoutineEditor({
              id: newId(),
              name: 'My routine',
              createdAt: new Date().toISOString(),
              legs: [
                { state: selection.mentalState, intensity: selection.intensity, minutes: 25 },
                { state: 'relax', intensity: 0.4, minutes: 5 },
              ],
            })
          }
          onDelete={(id) => {
            deleteRoutine(id);
            data.refreshRoutines();
          }}
        />
      )}

      {screen === 'setup' && motion.possible && settings.motionConsentAt && (
        <p className="hint heart-rate-status">
          📱 Phone motion: {motion.status === 'connected' ? 'sensing' : 'starts when you begin'} — lay
          the phone on the bed and leave the screen on
        </p>
      )}

      {screen === 'setup' && biometrics.possible && settings.biometricsConsentAt && (
        <p className="hint heart-rate-status">
          ❤ Heart-rate sensor:{' '}
          {biometrics.status === 'connected' ? (
            'connected'
          ) : (
            <button type="button" className="link-button inline" onClick={() => navigate('settings')}>
              not connected — connect in Settings
            </button>
          )}
        </p>
      )}

      <ErrorBoundary key={screen}>
      <Suspense fallback={SCREEN_LOADING}>
      {screen === 'settings' && (
        <SettingsScreen
          settings={settings}
          onChange={(change) => {
            updateSettings(change);
            if (change.monoMode !== undefined) session.setMonoMode(change.monoMode);
          }}
          onReplayTour={() => {
            setTourReplay(true);
            navigate('setup');
          }}
          onBack={() => navigate('setup')}
          biometrics={
            biometrics.possible || motion.possible ? (
              <>
                {biometrics.possible && (
                  <BiometricsPanel
                    status={biometrics.status}
                    consented={Boolean(settings.biometricsConsentAt)}
                    simulated={biometrics.simulated}
                    onConsent={(consented) =>
                      updateSettings({
                        biometricsConsentAt: consented ? new Date().toISOString() : null,
                      })
                    }
                    onConnect={() => void biometrics.connect()}
                    onDisconnect={biometrics.disconnect}
                  />
                )}
                {motion.possible && (
                  <MotionPanel
                    status={motion.status}
                    consented={Boolean(settings.motionConsentAt)}
                    simulated={motion.simulated}
                    onConsent={(consented) => {
                      updateSettings({ motionConsentAt: consented ? new Date().toISOString() : null });
                      if (!consented) motion.stop();
                    }}
                    onStart={() => void motion.start()}
                  />
                )}
                {(settings.biometricsConsentAt || settings.motionConsentAt) && (
                  <SleepOnsetToggle
                    checked={settings.sleepOnsetFade === true}
                    onChange={(on) => updateSettings({ sleepOnsetFade: on })}
                  />
                )}
              </>
            ) : undefined
          }
          data={<DataPanel onImported={data.reloadAll} onImportShare={importShare} />}
        />
      )}

      {screen === 'insights' && (
        <InsightsScreen
          insights={data.insights}
          onBack={() => navigate('setup')}
          starting={session.starting}
          startError={session.startError}
          onTryArm={(state, armId) => {
            const intensity =
              data.insights.find((i) => i.state === state)?.lastIntensity ?? selection.intensity;
            // Mirror the selection so setup reads right afterwards, and start
            // inside this same tap (iOS gesture rule).
            selection.selectState(state);
            void session.begin({ pinArm: { state, armId, intensity } });
          }}
        />
      )}

      {screen === 'history' && (
        <HistoryScreen
          sessions={data.historySessions}
          programs={programs}
          presets={presets}
          onReplay={(record) => {
            selection.replayFrom(record);
            navigate('setup');
          }}
          onUseProgram={(program) => {
            selection.selectProgram(program);
            navigate('setup');
          }}
          onBack={() => navigate('setup')}
        />
      )}

      {screen === 'routineEditor' && editingRoutine && (
        <RoutineEditor
          routine={editingRoutine}
          onSave={(routine) => {
            saveRoutine(routine);
            data.refreshRoutines();
            navigate('setup');
          }}
          onCancel={() => navigate('setup')}
        />
      )}

      {screen === 'programEditor' && editingProgram && (
        <ProgramEditor
          program={editingProgram}
          exporter={exporter}
          chimeEnabled={settings.chimeEnabled}
          onSave={handleSaveProgram}
          onCancel={() => navigate('setup')}
        />
      )}

      {screen === 'lab' && (
        <LabScreen
          ensureEngine={session.ensureEngine}
          getEngine={session.getEngine}
          presets={presets}
          programs={programs}
          exporter={exporter}
          chimeEnabled={settings.chimeEnabled}
          onSavePreset={(name, profile, state, labIntensity) => {
            savePreset({
              id: newId(),
              name,
              createdAt: new Date().toISOString(),
              state,
              intensity: labIntensity,
              profile,
            });
            data.refreshPresets();
          }}
          onBack={() => navigate('setup')}
        />
      )}
      </Suspense>
      </ErrorBoundary>

      {screen !== 'session' && <UpdateToast />}

      {screen === 'session' && controller && session.liveProfile && (
        <SessionView
          controller={controller}
          mentalState={sessionState}
          routine={session.routineLeg ?? undefined}
          nightstand={nightstandFor(sessionState, settings.nightstand)}
          getAnalyser={settings.visualizer === false ? undefined : getAnalyser}
          program={session.getSessionProgram() ?? undefined}
          breathing={session.getSessionBreathing() ?? undefined}
          explanation={soundExplanation ?? undefined}
          profile={session.liveProfile}
          onProfileChange={session.handleProfileChange}
          onStop={session.stop}
          onSavePreset={(name) => session.storePreset(name, null)}
          microPrompt={
            adaptation.microPrompt
              ? {
                  onRespond: adaptation.answerPrompt,
                  onDismiss: () => adaptation.answerPrompt(null),
                }
              : undefined
          }
        />
      )}

      {screen === 'feedback' && lastSession && (
        <FeedbackScreen
          stateLabel={STATES[lastSession.state].label}
          completed={lastSession.completed}
          moodState={
            lastSession.moodBefore !== undefined && lastSession.state !== 'sleep'
              ? lastSession.state
              : undefined
          }
          earlierLegs={lastSession.routineLegs?.map((leg) => ({
            recordId: leg.recordId,
            label: `${STATES[leg.state].emoji} ${STATES[leg.state].label.toLowerCase()}`,
          }))}
          onRate={feedback.rate}
          onSkip={feedback.skip}
          onSavePreset={(name) => session.storePreset(name, lastSession)}
        />
      )}

      <FooterDisclaimer />
    </main>
  );
}
