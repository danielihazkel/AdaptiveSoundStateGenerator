import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STATES } from './audio/states';
import { resolveSetupExport } from './export/setupExport';
import { useMp3Export } from './export/useMp3Export';
import type { Program } from './programs/types';
import {
  deletePreset,
  deleteProgram,
  movePresetInList,
  newId,
  renamePreset,
  savePreset,
  saveProgram,
  setPresetFavorite,
} from './storage/storage';
import type { SharePayload } from './share/shareLink';
import { DEFAULT_WAKE_UP, modeFor, type Theme } from './storage/types';
import { BiometricsPanel } from './ui/BiometricsPanel';
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
import { ShareImportModal } from './ui/ShareImportModal';

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

const SCREEN_LOADING = (
  <p className="hint" role="status">
    Loading…
  </p>
);

const STORAGE_NOTICES = {
  write:
    "Couldn't save to this device's storage (it may be full). Your session history may not be recorded — export your data from “Your data” below to keep it safe.",
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

/** `?lab` opens the lab directly; otherwise the hash names the screen. The editor needs a draft, so it can't be a landing screen. */
function initialScreen(): Screen {
  if (new URLSearchParams(window.location.search).has('lab')) return 'lab';
  const fromHash = screenForHash(window.location.hash);
  return fromHash && fromHash !== 'programEditor' ? fromHash : 'setup';
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
      if (to === 'lab' && !sessionRef.current?.prepareLab()) return false;
      if (to === 'programEditor' && !editingProgramRef.current) return false;
      return true;
    },
  });

  const data = useStoredData(screen);
  const { settings, updateSettings, presets, programs } = data;
  const coach = useCoach();
  const selection = useSetupSelection({ onUserOverride: coach.reset });
  const biometrics = useBiometrics();
  const exporter = useMp3Export({
    options: settings.export,
    onOptionsChange: (next) => updateSettings({ export: next }),
  });
  const tabGuard = useTabGuard();
  const share = useShareImport();
  useQuickStart(selection);

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
    setLiveProfile: (profile) => sessionRef.current?.setLiveProfile(profile),
  });
  const session = useSessionOrchestrator({
    settings,
    selection,
    presets,
    programs,
    adaptation,
    biometrics,
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
  // sessions already predates it and just gets it marked as seen.
  const showTour = screen === 'setup' && shouldShowTour(settings, data.historyAvailable);
  useEffect(() => {
    if (shouldAutoCompleteTour(settings, data.historyAvailable)) {
      updateSettings({ onboardingCompletedAt: new Date().toISOString() });
    }
  }, [settings, data.historyAvailable, updateSettings]);

  // Closing the tab mid-session drops the session record; mid-export it
  // drops the render. Ask first.
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
    });

  const lastSession = session.getLastSession();
  const controller = session.getController();

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
          onDone={() => updateSettings({ onboardingCompletedAt: new Date().toISOString() })}
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
          intervals={selection.intervals}
          onIntervalsChange={selection.setIntervals}
          presets={presets}
          selectedPresetId={selection.selectedPresetId}
          programs={programs}
          selectedProgramId={selection.selectedProgramId}
          monoMode={settings.monoMode}
          chimeEnabled={settings.chimeEnabled}
          adaptationEnabled={settings.adaptationEnabled !== false}
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
          onToggleAdaptation={(enabled) => updateSettings({ adaptationEnabled: enabled })}
          theme={theme}
          onThemeChange={(next) => updateSettings({ theme: next })}
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
          onBegin={() => void session.begin()}
          exporter={exporter}
          onDownload={handleDownload}
        />
      )}

      {screen === 'setup' && biometrics.possible && (
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

      {screen === 'setup' && <DataPanel onImported={data.reloadAll} onImportShare={importShare} />}

      <Suspense fallback={SCREEN_LOADING}>
      {screen === 'insights' && (
        <InsightsScreen insights={data.insights} onBack={() => navigate('setup')} />
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

      {screen === 'session' && controller && session.liveProfile && (
        <SessionView
          controller={controller}
          mentalState={adaptation.getMeta()?.state ?? selection.mentalState}
          program={session.getSessionProgram() ?? undefined}
          breathing={session.getSessionBreathing() ?? undefined}
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
          onRate={feedback.rate}
          onSkip={feedback.skip}
          onSavePreset={(name) => session.storePreset(name, lastSession)}
        />
      )}

      <FooterDisclaimer />
    </main>
  );
}
