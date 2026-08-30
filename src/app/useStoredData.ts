import { useEffect, useMemo, useRef, useState } from 'react';
import { STATES, type MentalState } from '../audio/states';
import { COLD_START_SESSIONS, eligibleSessionCount } from '../personalization/bandit';
import { CANDIDATE_SET_VERSION } from '../personalization/candidates';
import { computeInsights, MIN_SESSIONS_FOR_INSIGHTS } from '../personalization/insights';
import { findPendingMorningPrompt } from '../personalization/morningPrompt';
import { resolvePendingOutcomes } from '../personalization/personalizer';
import { recoverSession } from '../session/inProgress';
import {
  appendSession,
  clearInProgress,
  getStorageFailure,
  loadInProgress,
  loadPersonalization,
  loadPresets,
  loadPrograms,
  loadSessions,
  loadSettings,
  onStorageFailure,
  saveSettings,
  type StorageFailureKind,
} from '../storage/storage';
import type { SessionRecord, Settings } from '../storage/types';
import type { Screen } from './types';

/**
 * Everything the app reads from localStorage, as React state: settings,
 * presets, programs, and the derived views of the session history. Storage
 * is not reactive, so writers call `bumpData()` (or the refresh helpers) to
 * invalidate the memos.
 */
export function useStoredData(screen: Screen) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [presets, setPresets] = useState(() => loadPresets());
  const [programs, setPrograms] = useState(() => loadPrograms());
  const [morningPrompt, setMorningPrompt] = useState<SessionRecord | null>(null);
  /** A session the app died in the middle of was just added to history. */
  const [recoveredSession, setRecoveredSession] = useState<SessionRecord | null>(null);
  /** Bumped whenever stored sessions/personalization change, to refresh memos. */
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = () => setDataVersion((v) => v + 1);

  /**
   * A localStorage write failed, or stored data had to be set aside on read
   * (A9). The initial loads above run before any effect can subscribe, so
   * seed from the last failure they may already have recorded.
   */
  const [storageFailure, setStorageFailure] = useState<StorageFailureKind | null>(
    () => getStorageFailure()?.kind ?? null,
  );
  useEffect(() => onStorageFailure((f) => setStorageFailure(f.kind)), []);

  // Settle any sessions whose rating opportunity has passed (implicit-only),
  // then check whether last night's sleep session needs its morning rating.
  useEffect(() => {
    // A leftover checkpoint means the last session never finished writing.
    const checkpoint = loadInProgress();
    if (checkpoint) {
      const recovered = recoverSession(checkpoint);
      clearInProgress();
      if (recovered) {
        appendSession(recovered);
        setRecoveredSession(recovered);
      }
    }
    resolvePendingOutcomes();
    setMorningPrompt(findPendingMorningPrompt(loadSessions(), new Date()));
    bumpData();
  }, []);

  const { activeStates, insightsAvailable, historyAvailable, lastSession } = useMemo(() => {
    void dataVersion; // memo key: stored data changed
    const personalization = loadPersonalization(CANDIDATE_SET_VERSION);
    const counts = new Map<MentalState, number>();
    const stored = loadSessions();
    for (const s of stored) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
    const active = new Set<MentalState>();
    for (const state of Object.keys(STATES) as MentalState[]) {
      if (eligibleSessionCount(personalization, state) >= COLD_START_SESSIONS) {
        active.add(state);
      }
    }
    return {
      activeStates: active,
      insightsAvailable: [...counts.values()].some((c) => c >= MIN_SESSIONS_FOR_INSIGHTS),
      historyAvailable: stored.length > 0,
      // Newest non-recovered session, for "Play last" (records are newest-first).
      lastSession: stored.find((s) => !s.recovered) ?? null,
    };
  }, [dataVersion]);

  // dataVersion is the memo key for "stored data changed" (see bumpData) —
  // localStorage isn't reactive, so the lint rule can't see the dependency.
  const historySessions = useMemo(() => {
    void dataVersion;
    return screen === 'history' ? loadSessions() : [];
  }, [screen, dataVersion]);

  const insights = useMemo(() => {
    void dataVersion;
    return screen === 'insights'
      ? computeInsights(loadSessions(), loadPersonalization(CANDIDATE_SET_VERSION))
      : [];
  }, [screen, dataVersion]);

  // Persist settings in an effect, not inside the state updater (updaters
  // must be pure — StrictMode runs them twice). The flag keeps the initial
  // mount from writing: loadSettings() deliberately leaves a newer-schema
  // payload untouched, and an unconditional save-on-change would clobber it.
  const settingsDirtyRef = useRef(false);
  useEffect(() => {
    if (!settingsDirtyRef.current) return;
    settingsDirtyRef.current = false;
    saveSettings(settings);
  }, [settings]);
  const updateSettings = (change: Partial<Settings>) => {
    settingsDirtyRef.current = true;
    setSettings((prev) => ({ ...prev, ...change }));
  };

  return {
    settings,
    updateSettings,
    presets,
    refreshPresets: () => setPresets(loadPresets()),
    programs,
    refreshPrograms: () => setPrograms(loadPrograms()),
    /** After a JSON import replaced things wholesale. */
    reloadAll: () => {
      setSettings(loadSettings());
      setPresets(loadPresets());
      setPrograms(loadPrograms());
      bumpData();
    },
    bumpData,
    storageFailure,
    dismissStorageFailure: () => setStorageFailure(null),
    activeStates,
    insightsAvailable,
    historyAvailable,
    lastSession,
    recoveredSession,
    dismissRecoveredSession: () => setRecoveredSession(null),
    historySessions,
    insights,
    morningPrompt,
    setMorningPrompt,
  };
}

export type StoredData = ReturnType<typeof useStoredData>;
