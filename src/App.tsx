import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STATES } from './audio/states';
import { resolveSetupExport } from './export/setupExport';
import { useMp3Export } from './export/useMp3Export';
import type { Program } from './programs/types';
import { deletePreset, deleteProgram, newId, savePreset, saveProgram } from './storage/storage';
import { DEFAULT_WAKE_UP, modeFor, type Theme } from './storage/types';
import { BiometricsPanel } from './ui/BiometricsPanel';
import { CoachInput } from './ui/CoachInput';
import { DataPanel } from './ui/DataPanel';
import { FeedbackScreen } from './ui/FeedbackScreen';
import { MorningPromptModal } from './ui/MorningPrompt';
import { DisclaimerModal, FooterDisclaimer } from './ui/SafetyNotices';
import { SetupScreen } from './ui/SetupScreen';
import { SessionView } from './app/SessionView';
import { setReloadBusy } from './app/reloadGate';
import type { Screen } from './app/types';
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

/**
 * Screen routing and wiring. The behavior lives in src/app/: stored data,
 * setup selection, the coach, biometrics, the adaptation loop, and the
 * session orchestrator that owns the audio engine.
 */
export function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).has('lab') ? 'lab' : 'setup',
  );
  /** Draft under edit in the program editor screen. */
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);

  const data = useStoredData(screen);
  const { settings, updateSettings, presets, programs } = data;
  const coach = useCoach();
  const selection = useSetupSelection({ onUserOverride: coach.reset });
  const biometrics = useBiometrics();
  const exporter = useMp3Export();
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

  // Screens are conditionally rendered, not routed — move focus to the
  // heading on each change so keyboard and screen-reader users land at the
  // top of the new screen instead of on a vanished button.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [screen]);

  // The orchestrator and the adaptation loop reference each other; the loop
  // reaches the orchestrator through a ref that is synced after each commit
  // (never written during render), and only ever dereferences it at call
  // time (checkpoints).
  const sessionRef = useRef<SessionOrchestrator | null>(null);
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
    onFinished: setScreen,
    onSessionStarted: () => setScreen('session'),
  });
  useLayoutEffect(() => {
    sessionRef.current = session;
  });
  const feedback = useFeedbackHandlers({
    getLastSession: session.getLastSession,
    morningPrompt: data.morningPrompt,
    setMorningPrompt: data.setMorningPrompt,
    bumpData: data.bumpData,
    onDone: () => setScreen('setup'),
  });

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

  const openLab = () => {
    if (session.prepareLab()) setScreen('lab');
  };

  const closeLab = () => {
    session.releaseLab();
    setScreen('setup');
  };

  const handleSaveProgram = (program: Program) => {
    saveProgram(program);
    data.refreshPrograms();
    selection.selectProgram(program);
    setEditingProgram(null);
    setScreen('setup');
  };

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

      {settings.disclaimerAcknowledgedAt && data.morningPrompt && screen === 'setup' && (
        <MorningPromptModal onRate={feedback.morningRate} onDismiss={feedback.morningDismiss} />
      )}

      {settings.disclaimerAcknowledgedAt && !data.morningPrompt && share.pending && screen === 'setup' && (
        <ShareImportModal
          pending={share.pending}
          onDismiss={share.dismiss}
          onImport={(payload) => {
            const now = new Date().toISOString();
            if (payload.kind === 'program') {
              const program = { ...payload.program, id: newId(), createdAt: now };
              saveProgram(program);
              data.refreshPrograms();
              selection.selectProgram(program);
            } else {
              const preset = { id: newId(), createdAt: now, ...payload.preset };
              savePreset(preset);
              data.refreshPresets();
              selection.selectState(preset.state);
              selection.selectPreset(preset);
            }
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
          onSelectProgram={selection.selectProgram}
          onDeleteProgram={(id) => {
            deleteProgram(id);
            data.refreshPrograms();
            selection.forgetProgram(id);
          }}
          onNewProgram={(template) => {
            setEditingProgram(template.build(selection.mentalState, selection.intensity));
            setScreen('programEditor');
          }}
          onEditProgram={(program) => {
            setEditingProgram(program);
            setScreen('programEditor');
          }}
          onOpenLab={openLab}
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
          onShowHistory={() => setScreen('history')}
          onModeChange={(mode) =>
            updateSettings({
              personalizationMode: {
                ...settings.personalizationMode,
                [selection.mentalState]: mode,
              },
            })
          }
          onShowInsights={() => setScreen('insights')}
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

      {screen === 'setup' && <DataPanel onImported={data.reloadAll} />}

      <Suspense fallback={SCREEN_LOADING}>
      {screen === 'insights' && (
        <InsightsScreen insights={data.insights} onBack={() => setScreen('setup')} />
      )}

      {screen === 'history' && (
        <HistoryScreen
          sessions={data.historySessions}
          programs={programs}
          presets={presets}
          onReplay={(record) => {
            selection.replayFrom(record);
            setScreen('setup');
          }}
          onUseProgram={(program) => {
            selection.selectProgram(program);
            setScreen('setup');
          }}
          onBack={() => setScreen('setup')}
        />
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
          onBack={closeLab}
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
