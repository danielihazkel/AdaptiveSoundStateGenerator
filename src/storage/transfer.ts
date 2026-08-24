import { rebuildFromSessions } from '../personalization/bandit';
import { CANDIDATE_SET_VERSION } from '../personalization/candidates';
import type { Program } from '../programs/types';
import {
  loadPersonalization,
  loadPresets,
  loadPrograms,
  loadSessions,
  loadSettings,
  overwritePresets,
  overwritePrograms,
  overwriteSessions,
  savePersonalization,
  saveSettings,
} from './storage';
import {
  SCHEMA_VERSION,
  type PersonalizationState,
  type Preset,
  type SessionRecord,
  type Settings,
} from './types';

/**
 * Manual cross-device transfer (PRD §14 — accounts deferred, local-first kept):
 * a single JSON bundle of everything on-device. Import MERGES, never wipes.
 */
export interface ExportBundle {
  format: 'resonance-export';
  formatVersion: 1;
  exportedAt: string; // ISO
  schemaVersion: typeof SCHEMA_VERSION;
  settings: Settings;
  presets: Preset[];
  sessions: SessionRecord[];
  /** Informational — the posterior is rebuilt from merged sessions on import. */
  personalization: PersonalizationState;
  /** Absent in bundles exported before programs existed. */
  programs?: Program[];
}

export function buildExportBundle(): ExportBundle {
  return {
    format: 'resonance-export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    settings: loadSettings(),
    presets: loadPresets(),
    sessions: loadSessions(),
    personalization: loadPersonalization(CANDIDATE_SET_VERSION),
    programs: loadPrograms(),
  };
}

export type ValidationResult =
  | { ok: true; bundle: ExportBundle }
  | { ok: false; error: string };

function isRecordWithId(item: unknown): boolean {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { id?: unknown }).id === 'string'
  );
}

/** Checks just enough shape that import can't corrupt storage; never partial. */
export function validateBundle(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'This file is not a Resonance export.' };
  }
  const bundle = raw as Partial<ExportBundle>;
  if (bundle.format !== 'resonance-export') {
    return { ok: false, error: 'This file is not a Resonance export.' };
  }
  if (bundle.formatVersion !== 1) {
    return {
      ok: false,
      error: 'This export was made by a newer version of Resonance.',
    };
  }
  if (!Array.isArray(bundle.presets) || !Array.isArray(bundle.sessions)) {
    return { ok: false, error: 'This export file is incomplete or damaged.' };
  }
  if (![...bundle.presets, ...bundle.sessions].every(isRecordWithId)) {
    return { ok: false, error: 'This export file is incomplete or damaged.' };
  }
  if (
    !bundle.sessions.every(
      (s) => typeof s.state === 'string' && typeof s.profile === 'object',
    )
  ) {
    return { ok: false, error: 'This export file is incomplete or damaged.' };
  }
  if (typeof bundle.settings !== 'object' || bundle.settings === null) {
    return { ok: false, error: 'This export file is incomplete or damaged.' };
  }
  if (
    bundle.programs !== undefined &&
    (!Array.isArray(bundle.programs) || !bundle.programs.every(isRecordWithId))
  ) {
    return { ok: false, error: 'This export file is incomplete or damaged.' };
  }
  return { ok: true, bundle: bundle as ExportBundle };
}

export interface ImportSummary {
  presetsAdded: number;
  sessionsAdded: number;
  programsAdded: number;
}

/**
 * Merge semantics: presets and sessions union by id (re-importing the same
 * bundle is a no-op), sessions newest-first under the storage cap. Imported
 * settings win, except a non-null local disclaimer acknowledgement is kept.
 * Bandit stats are never merged — double-importing would double-count — the
 * posterior is deterministically rebuilt from the merged session records.
 */
export function importBundle(bundle: ExportBundle): ImportSummary {
  const localPresets = loadPresets();
  const presetIds = new Set(localPresets.map((p) => p.id));
  const newPresets = bundle.presets.filter((p) => !presetIds.has(p.id));
  overwritePresets([...localPresets, ...newPresets]);

  const localPrograms = loadPrograms();
  const programIds = new Set(localPrograms.map((p) => p.id));
  const newPrograms = (bundle.programs ?? []).filter((p) => !programIds.has(p.id));
  overwritePrograms([...localPrograms, ...newPrograms]);

  const localSessions = loadSessions();
  const sessionIds = new Set(localSessions.map((s) => s.id));
  const newSessions = bundle.sessions.filter((s) => !sessionIds.has(s.id));
  const merged = [...localSessions, ...newSessions].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  overwriteSessions(merged);

  const localSettings = loadSettings();
  saveSettings({
    ...localSettings,
    ...bundle.settings,
    schemaVersion: SCHEMA_VERSION,
    disclaimerAcknowledgedAt:
      localSettings.disclaimerAcknowledgedAt ??
      bundle.settings.disclaimerAcknowledgedAt,
  });

  savePersonalization(rebuildFromSessions(loadSessions()));

  return {
    presetsAdded: newPresets.length,
    sessionsAdded: newSessions.length,
    programsAdded: newPrograms.length,
  };
}
