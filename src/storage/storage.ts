import { normalizeProfile } from '../audio/types';
import { normalizeProgram, type Program } from '../programs/types';
import { movePreset } from './presetOrder';
import {
  countSessions,
  deleteSessions,
  getAllSessions,
  openSessionDb,
  putSessions,
  replaceAllSessions,
} from './sessionDb';
import {
  defaultSettings,
  SCHEMA_VERSION,
  type FeedbackInput,
  type InProgressSession,
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
const IN_PROGRESS_KEY = 'resonance.v1.inProgress';

/** Oldest records are dropped past this — plenty for Phase 2 training. */
const MAX_SESSION_RECORDS = 500;

/** Every key this module owns starts with this. */
const KEY_PREFIX = 'resonance.';
/** Web Locks name serialising the startup settle sweep across tabs. */
export const STORAGE_LOCK_NAME = 'resonance.storage';

/**
 * Fires when *another* tab writes one of our keys — the native `storage`
 * event never fires in the tab that wrote. Lets the React-side cache refresh
 * instead of going stale behind the second tab tabGuard warns about.
 * `key` is '*' when the other tab cleared storage.
 */
export function onStorageChanged(listener: (key: string) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const handler = (event: StorageEvent) => {
    if (event.key === null) {
      listener('*');
      return;
    }
    if (event.key.startsWith(KEY_PREFIX)) listener(event.key);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/**
 * Run a read-modify-write sweep under the cross-tab storage lock when the
 * browser has Web Locks; synchronously otherwise (the pre-existing
 * single-tab assumption). `fn` runs exactly once either way.
 */
export function withStorageLock(
  fn: () => void,
  locks: LockManager | undefined = (globalThis.navigator as Navigator | undefined)?.locks,
): void {
  if (!locks) {
    fn();
    return;
  }
  let ran = false;
  locks
    .request(STORAGE_LOCK_NAME, () => {
      ran = true;
      fn();
    })
    .catch(() => {
      if (!ran) fn();
    });
}

/** Suffix under which an unreadable payload is preserved (see quarantine). */
export const QUARANTINE_SUFFIX = '.quarantine';

interface ListPayload<T> {
  schemaVersion: number;
  items: T[];
}

/**
 * Every read is guarded: a corrupt or foreign payload never crashes the app.
 * What happens to the bytes depends on *why* they were unreadable:
 *
 *  - newer schemaVersion than this build knows → the payload is left in place
 *    (a newer build can still read it) and a copy is quarantined; this build
 *    sees the key as empty and reports 'incompatible'.
 *  - older schemaVersion → run through LIST_MIGRATIONS and written back.
 *  - anything else (not JSON, wrong shape) → quarantined, reset to the
 *    default, reported as 'corrupt'.
 *
 * localStorage writes can also throw (quota, private browsing) — those are
 * swallowed and reported as 'write'; losing a record beats losing the session.
 */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** undefined = stored but unparseable (distinct from null = nothing stored). */
function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export type StorageFailureKind = 'write' | 'incompatible' | 'corrupt';

export interface StorageFailure {
  key: string;
  at: number; // epoch ms
  /** 'write' = a save failed; the read kinds mean stored data was set aside. */
  kind: StorageFailureKind;
}

type FailureListener = (failure: StorageFailure) => void;

let lastFailure: StorageFailure | null = null;
const failureListeners = new Set<FailureListener>();

/**
 * Failures stay non-fatal (a full disk must never kill a session), but the
 * app is told so it can warn the user. Any number of subscribers; returns an
 * unsubscribe.
 */
export function onStorageFailure(listener: FailureListener): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

export function getStorageFailure(): StorageFailure | null {
  return lastFailure;
}

/** Test hook / after the user has resolved the problem. */
export function clearStorageFailure(): void {
  lastFailure = null;
}

function reportFailure(key: string, kind: StorageFailureKind): void {
  lastFailure = { key, at: Date.now(), kind };
  for (const listener of failureListeners) listener(lastFailure);
}

function writeRaw(key: string, raw: string): boolean {
  try {
    localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

function writeJson(key: string, value: unknown): void {
  // Quota exceeded / storage unavailable — deliberately non-fatal.
  if (!writeRaw(key, JSON.stringify(value))) reportFailure(key, 'write');
}

/**
 * Preserve the untouched bytes of a payload this build cannot use, under
 * `<key>.quarantine`. First casualty wins: an existing quarantine is never
 * overwritten, so the evidence of the original problem survives reloads.
 */
function quarantine(key: string, raw: string | null): void {
  if (raw === null) return;
  const qKey = key + QUARANTINE_SUFFIX;
  if (readRaw(qKey) !== null) return;
  writeRaw(qKey, raw); // best effort — not worth a second warning if it fails
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `absent` = nothing stored; `current` = usable as is; `older` = needs
 * migration; `newer` = written by a later build; `corrupt` = unparseable or
 * unstamped.
 */
type SchemaStatus = 'absent' | 'current' | 'older' | 'newer' | 'corrupt';

function schemaStatus(raw: string | null, payload: unknown): SchemaStatus {
  if (raw === null) return 'absent';
  if (!isRecord(payload)) return 'corrupt';
  const v = payload.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v)) return 'corrupt';
  if (v === SCHEMA_VERSION) return 'current';
  return v > SCHEMA_VERSION ? 'newer' : 'older';
}

/**
 * List migrations keyed by the version they migrate *from*; each returns a
 * payload one version newer. Empty while SCHEMA_VERSION is 1 — this is the
 * scaffold future schema bumps use instead of piling onto normalize-on-read.
 */
const LIST_MIGRATIONS: Record<
  number,
  (payload: ListPayload<unknown>) => ListPayload<unknown>
> = {};

function migrateList(payload: ListPayload<unknown>): ListPayload<unknown> | null {
  let current = payload;
  while (current.schemaVersion < SCHEMA_VERSION) {
    const step = LIST_MIGRATIONS[current.schemaVersion];
    if (!step) return null; // no path forward — treated as corrupt
    current = step(current);
  }
  return current;
}

function readList<T>(key: string): T[] {
  const raw = readRaw(key);
  const payload = parse(raw);
  const status = schemaStatus(raw, payload);
  if (status === 'absent') return [];
  if (status === 'newer') {
    // Leave the newer payload untouched for the build that wrote it.
    quarantine(key, raw);
    reportFailure(key, 'incompatible');
    return [];
  }
  const list = payload as ListPayload<T>;
  if (status !== 'corrupt' && Array.isArray(list.items)) {
    if (status === 'current') return list.items;
    const migrated = migrateList(list);
    if (migrated) {
      writeList(key, migrated.items);
      return migrated.items as T[];
    }
  }
  // Unparseable, unstamped, or an unmigratable shape: set it aside and reset.
  quarantine(key, raw);
  reportFailure(key, 'corrupt');
  writeList(key, []);
  return [];
}

function writeList<T>(key: string, items: T[]): void {
  writeJson(key, { schemaVersion: SCHEMA_VERSION, items } satisfies ListPayload<T>);
}

export { newId } from './id';

// --- Settings ---------------------------------------------------------------

export function loadSettings(): Settings {
  const raw = readRaw(SETTINGS_KEY);
  const payload = parse(raw);
  const status = schemaStatus(raw, payload);
  if (status === 'current') return { ...defaultSettings, ...(payload as Partial<Settings>) };
  if (status === 'newer') {
    quarantine(SETTINGS_KEY, raw);
    reportFailure(SETTINGS_KEY, 'incompatible');
  } else if (status === 'corrupt') {
    // Settings carry nothing irreplaceable, so no warning — just keep the
    // bytes in case they matter, and fall back (the disclaimer re-shows).
    quarantine(SETTINGS_KEY, raw);
  }
  return { ...defaultSettings };
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

export function renamePreset(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  writeList(
    PRESETS_KEY,
    loadPresets().map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  );
}

export function setPresetFavorite(id: string, favorite: boolean): void {
  writeList(
    PRESETS_KEY,
    loadPresets().map((p) => (p.id === id ? { ...p, favorite } : p)),
  );
}

/** One step up (-1) or down (+1) within the preset's displayed strip. */
export function movePresetInList(id: string, direction: -1 | 1): void {
  writeList(PRESETS_KEY, movePreset(loadPresets(), id, direction));
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
//
// Records live in IndexedDB behind a write-through in-memory cache: reads stay
// synchronous (everything above this layer — memos, the personalizer, export —
// calls loadSessions() inline), writes update the cache at once and persist
// asynchronously. Until initSessionStore() resolves, and wherever IndexedDB
// is unavailable, the localStorage list (with its 500-record cap) is used
// exactly as before.

/** Cap once records live in IndexedDB — no 5 MB localStorage budget to share. */
export const MAX_SESSION_RECORDS_DB = 5000;
const SESSIONS_MIGRATED_KEY = 'resonance.v1.sessions.migratedAt';

export type SessionStoreBackend = 'indexeddb' | 'localStorage';

let sessionDb: IDBDatabase | null = null;
let sessionCache: SessionRecord[] | null = null;
let sessionInit: Promise<SessionStoreBackend> | null = null;
let sessionBackend: SessionStoreBackend | null = null;

function newestFirst(records: readonly SessionRecord[]): SessionRecord[] {
  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/**
 * Open IndexedDB, move any localStorage records into it once (verified
 * before the localStorage copy is retired), and fill the cache. Resolves
 * with the backend in use. Idempotent — every caller shares one attempt.
 */
export function initSessionStore(factory?: IDBFactory): Promise<SessionStoreBackend> {
  if (!sessionInit) sessionInit = initSessionStoreOnce(factory);
  return sessionInit;
}

async function initSessionStoreOnce(factory?: IDBFactory): Promise<SessionStoreBackend> {
  const db = await openSessionDb(factory);
  if (!db) {
    sessionBackend = 'localStorage';
    return sessionBackend;
  }
  try {
    let records = await getAllSessions(db);
    if (readRaw(SESSIONS_KEY) !== null) {
      const legacy = readList<SessionRecord>(SESSIONS_KEY);
      const known = new Set(records.map((r) => r.id));
      const missing = legacy.filter((r) => !known.has(r.id));
      await putSessions(db, missing);
      if ((await countSessions(db)) < known.size + missing.length) {
        throw new Error('session migration incomplete');
      }
      records = [...records, ...missing];
      // Everything is verifiably in IndexedDB — retire the localStorage copy.
      try {
        localStorage.removeItem(SESSIONS_KEY);
      } catch {
        // Leaving it behind is harmless: IndexedDB wins on the next open.
      }
      writeRaw(SESSIONS_MIGRATED_KEY, new Date().toISOString());
    }
    sessionCache = newestFirst(records).slice(0, MAX_SESSION_RECORDS_DB);
    sessionDb = db;
    sessionBackend = 'indexeddb';
    // Ask the browser not to evict our data under storage pressure (best effort).
    void (globalThis.navigator as Navigator | undefined)?.storage?.persist?.().catch(() => undefined);
    return sessionBackend;
  } catch {
    // Migration failed part-way: localStorage is intact, keep serving from it.
    try {
      db.close();
    } catch {
      // nothing to release
    }
    sessionBackend = 'localStorage';
    return sessionBackend;
  }
}

/** Which backend serves session records; null until initSessionStore resolves. */
export function sessionStoreBackend(): SessionStoreBackend | null {
  return sessionBackend;
}

/** Test hook: forget the open database and cache. */
export function resetSessionStoreForTests(): void {
  try {
    sessionDb?.close();
  } catch {
    // already closed
  }
  sessionDb = null;
  sessionCache = null;
  sessionInit = null;
  sessionBackend = null;
}

function persistPut(records: SessionRecord[]): void {
  if (!sessionDb || records.length === 0) return;
  putSessions(sessionDb, records).catch(() => reportFailure(SESSIONS_KEY, 'write'));
}

function persistDelete(ids: string[]): void {
  if (!sessionDb || ids.length === 0) return;
  deleteSessions(sessionDb, ids).catch(() => reportFailure(SESSIONS_KEY, 'write'));
}

/** Newest first. The array is yours; the records are shared — never mutate them. */
export function loadSessions(): SessionRecord[] {
  return sessionCache ? sessionCache.slice() : readList<SessionRecord>(SESSIONS_KEY);
}

export function appendSession(record: SessionRecord): void {
  if (sessionCache) {
    const next = [record, ...sessionCache];
    const overflow = next.splice(MAX_SESSION_RECORDS_DB);
    sessionCache = next;
    persistPut([record]);
    persistDelete(overflow.map((r) => r.id));
    return;
  }
  const sessions = loadSessions();
  sessions.unshift(record);
  writeList(SESSIONS_KEY, sessions.slice(0, MAX_SESSION_RECORDS));
}

/** Replace one record by id (immutable — the cache never sees in-place edits). */
function updateSessionRecord(
  sessionId: string,
  patch: (record: SessionRecord) => SessionRecord,
): void {
  const sessions = loadSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) return;
  const next = patch(sessions[index]);
  sessions[index] = next;
  if (sessionCache) {
    sessionCache = sessions;
    persistPut([next]);
  } else {
    writeList(SESSIONS_KEY, sessions);
  }
}

// --- In-progress checkpoint ---------------------------------------------------

/** The running session's checkpoint, or null. Anything unreadable is dropped. */
export function loadInProgress(): InProgressSession | null {
  const value = parse(readRaw(IN_PROGRESS_KEY));
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as InProgressSession).startedAt === 'string' &&
    typeof (value as InProgressSession).elapsedSec === 'number' &&
    (value as InProgressSession).profile
  ) {
    const record = value as InProgressSession;
    return { ...record, profile: normalizeProfile(record.profile) };
  }
  if (value !== null) clearInProgress();
  return null;
}

export function saveInProgress(checkpoint: InProgressSession): void {
  writeJson(IN_PROGRESS_KEY, checkpoint);
}

export function clearInProgress(): void {
  try {
    localStorage.removeItem(IN_PROGRESS_KEY);
  } catch {
    /* unavailable — nothing to clear */
  }
}

/** Bulk replace after an import merge (transfer.ts) — not for general use. */
export function overwritePresets(presets: Preset[]): void {
  writeList(PRESETS_KEY, presets);
}

/** Bulk replace after an import merge (transfer.ts); the cap still applies. */
export function overwriteSessions(sessions: SessionRecord[]): void {
  if (sessionCache) {
    sessionCache = newestFirst(sessions).slice(0, MAX_SESSION_RECORDS_DB);
    if (sessionDb) {
      replaceAllSessions(sessionDb, sessionCache).catch(() =>
        reportFailure(SESSIONS_KEY, 'write'),
      );
    }
    return;
  }
  writeList(SESSIONS_KEY, sessions.slice(0, MAX_SESSION_RECORDS));
}

export function attachFeedback(sessionId: string, input: Rating | FeedbackInput): void {
  const feedback = typeof input === 'number' ? { rating: input } : input;
  updateSessionRecord(sessionId, (record) => ({
    ...record,
    feedback: {
      rating: feedback.rating,
      ratedAt: new Date().toISOString(),
      ...(feedback.distraction !== undefined ? { distraction: feedback.distraction } : {}),
      ...(feedback.useAgain !== undefined ? { useAgain: feedback.useAgain } : {}),
    },
  }));
}

/** Records the "declined to rate" implicit signal (PRD §9). Unknown id: no-op. */
export function markFeedbackSkipped(sessionId: string): void {
  updateSessionRecord(sessionId, (record) => ({ ...record, feedbackSkipped: true }));
}

/** Stamps a session as consumed by the bandit so it is never counted twice. */
export function markBanditResolved(sessionId: string): void {
  updateSessionRecord(sessionId, (record) => ({
    ...record,
    banditResolvedAt: new Date().toISOString(),
  }));
}

// --- Personalization ----------------------------------------------------------

export function emptyPersonalization(candidateSetVersion: number): PersonalizationState {
  return { schemaVersion: SCHEMA_VERSION, candidateSetVersion, arms: {} };
}

/**
 * A corrupt payload, schema mismatch, or a candidate-set version other than the
 * one the running code expects all reset to empty stats — recipes may have
 * changed meaning, so stale stats would silently corrupt the posterior. A
 * payload from a newer build is quarantined first (it is still rebuildable
 * from the session records, so this is belt-and-braces).
 */
export function loadPersonalization(expectedCandidateSetVersion: number): PersonalizationState {
  const raw = readRaw(PERSONALIZATION_KEY);
  const payload = parse(raw);
  const status = schemaStatus(raw, payload);
  if (status === 'newer') {
    quarantine(PERSONALIZATION_KEY, raw);
    reportFailure(PERSONALIZATION_KEY, 'incompatible');
    return emptyPersonalization(expectedCandidateSetVersion);
  }
  const state = payload as PersonalizationState;
  if (
    status !== 'current' ||
    state.candidateSetVersion !== expectedCandidateSetVersion ||
    typeof state.arms !== 'object' ||
    state.arms === null
  ) {
    return emptyPersonalization(expectedCandidateSetVersion);
  }
  return state;
}

export function savePersonalization(state: PersonalizationState): void {
  writeJson(PERSONALIZATION_KEY, state);
}

/**
 * The candidate-set version of whatever is stored, without the reset that
 * loadPersonalization applies on a mismatch — so an upgrade can rebuild the
 * posterior from the session records instead (personalizer.ts). null = nothing
 * stored or unreadable.
 */
export function peekPersonalizationVersion(): number | null {
  const payload = parse(readRaw(PERSONALIZATION_KEY));
  if (!payload || typeof payload !== 'object') return null;
  const version = (payload as { candidateSetVersion?: unknown }).candidateSetVersion;
  return typeof version === 'number' ? version : null;
}
