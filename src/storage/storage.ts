import { normalizeProfile } from '../audio/types';
import { normalizeProgram, type Program } from '../programs/types';
import {
  defaultSettings,
  SCHEMA_VERSION,
  type PersonalizationState,
  type Preset,
  type Rating,
  type SessionRecord,
  type Settings,
} from './types';

const SETTINGS_KEY = 'resonance.v1.settings';
const PRESETS_KEY = 'resonance.v1.presets';
const SESSIONS_KEY = 'resonance.v1.sessions';
const PROGRAMS_KEY = 'resonance.v1.programs';
const PERSONALIZATION_KEY = 'resonance.v1.personalization';

/** Oldest records are dropped past this — plenty for Phase 2 training. */
const MAX_SESSION_RECORDS = 500;

interface ListPayload<T> {
  schemaVersion: typeof SCHEMA_VERSION;
  items: T[];
}

/**
 * Every read is guarded: a corrupt or foreign payload resets that key to its
 * default instead of crashing the app. localStorage writes can also throw
 * (quota, private browsing) — those are swallowed; losing a record beats
 * losing the session.
 */
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / storage unavailable — deliberately non-fatal.
  }
}

function readList<T>(key: string): T[] {
  const payload = readJson(key) as ListPayload<T> | null;
  if (
    payload === null ||
    typeof payload !== 'object' ||
    payload.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(payload.items)
  ) {
    if (payload !== null) writeList(key, []); // reset corrupt key
    return [];
  }
  return payload.items;
}

function writeList<T>(key: string, items: T[]): void {
  writeJson(key, { schemaVersion: SCHEMA_VERSION, items } satisfies ListPayload<T>);
}

export { newId } from './id';

// --- Settings ---------------------------------------------------------------

export function loadSettings(): Settings {
  const raw = readJson(SETTINGS_KEY) as Partial<Settings> | null;
  if (raw === null || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA_VERSION) {
    return { ...defaultSettings };
  }
  return { ...defaultSettings, ...raw };
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings);
}

// --- Presets ----------------------------------------------------------------

export function loadPresets(): Preset[] {
  // Presets persist profiles verbatim and the schema never migrates — profiles
  // saved before a field existed are completed here so the engine never sees
  // a partial one (normalize on read only; stored bytes stay untouched).
  return readList<Preset>(PRESETS_KEY).map((preset) => ({
    ...preset,
    profile: normalizeProfile(preset.profile),
  }));
}

export function savePreset(preset: Preset): void {
  const presets = loadPresets().filter((p) => p.id !== preset.id);
  presets.unshift(preset);
  writeList(PRESETS_KEY, presets);
}

export function deletePreset(id: string): void {
  writeList(
    PRESETS_KEY,
    loadPresets().filter((p) => p.id !== id),
  );
}

// --- Programs ----------------------------------------------------------------

export function loadPrograms(): Program[] {
  // Same normalize-on-read contract as presets: stored bytes stay untouched,
  // partial or stale programs are completed before anything consumes them.
  return readList<Program>(PROGRAMS_KEY).map(normalizeProgram);
}

export function saveProgram(program: Program): void {
  const programs = loadPrograms().filter((p) => p.id !== program.id);
  programs.unshift(program);
  writeList(PROGRAMS_KEY, programs);
}

export function deleteProgram(id: string): void {
  writeList(
    PROGRAMS_KEY,
    loadPrograms().filter((p) => p.id !== id),
  );
}

/** Bulk replace after an import merge (transfer.ts) — not for general use. */
export function overwritePrograms(programs: Program[]): void {
  writeList(PROGRAMS_KEY, programs);
}

// --- Session records ----------------------------------------------------------

export function loadSessions(): SessionRecord[] {
  return readList<SessionRecord>(SESSIONS_KEY);
}

export function appendSession(record: SessionRecord): void {
  const sessions = loadSessions();
  sessions.unshift(record);
  writeList(SESSIONS_KEY, sessions.slice(0, MAX_SESSION_RECORDS));
}

/** Bulk replace after an import merge (transfer.ts) — not for general use. */
export function overwritePresets(presets: Preset[]): void {
  writeList(PRESETS_KEY, presets);
}

/** Bulk replace after an import merge (transfer.ts); the cap still applies. */
export function overwriteSessions(sessions: SessionRecord[]): void {
  writeList(SESSIONS_KEY, sessions.slice(0, MAX_SESSION_RECORDS));
}

export function attachFeedback(sessionId: string, rating: Rating): void {
  const sessions = loadSessions();
  const record = sessions.find((s) => s.id === sessionId);
  if (!record) return;
  record.feedback = { rating, ratedAt: new Date().toISOString() };
  writeList(SESSIONS_KEY, sessions);
}

/** Records the "declined to rate" implicit signal (PRD §9). Unknown id: no-op. */
export function markFeedbackSkipped(sessionId: string): void {
  const sessions = loadSessions();
  const record = sessions.find((s) => s.id === sessionId);
  if (!record) return;
  record.feedbackSkipped = true;
  writeList(SESSIONS_KEY, sessions);
}

/** Stamps a session as consumed by the bandit so it is never counted twice. */
export function markBanditResolved(sessionId: string): void {
  const sessions = loadSessions();
  const record = sessions.find((s) => s.id === sessionId);
  if (!record) return;
  record.banditResolvedAt = new Date().toISOString();
  writeList(SESSIONS_KEY, sessions);
}

// --- Personalization ----------------------------------------------------------

export function emptyPersonalization(candidateSetVersion: number): PersonalizationState {
  return { schemaVersion: SCHEMA_VERSION, candidateSetVersion, arms: {} };
}

/**
 * A corrupt payload, schema mismatch, or a candidate-set version other than the
 * one the running code expects all reset to empty stats — recipes may have
 * changed meaning, so stale stats would silently corrupt the posterior.
 */
export function loadPersonalization(expectedCandidateSetVersion: number): PersonalizationState {
  const raw = readJson(PERSONALIZATION_KEY) as PersonalizationState | null;
  if (
    raw === null ||
    typeof raw !== 'object' ||
    raw.schemaVersion !== SCHEMA_VERSION ||
    raw.candidateSetVersion !== expectedCandidateSetVersion ||
    typeof raw.arms !== 'object' ||
    raw.arms === null
  ) {
    return emptyPersonalization(expectedCandidateSetVersion);
  }
  return raw;
}

export function savePersonalization(state: PersonalizationState): void {
  writeJson(PERSONALIZATION_KEY, state);
}
