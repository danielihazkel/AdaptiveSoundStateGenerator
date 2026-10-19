import { STATES, type MentalState } from '../audio/states';

/**
 * Routines (Phase 14): a chain of states played back to back — energy into
 * focus, relax into sleep — with each leg handing over to the next without
 * a fade (SessionController.continueWith). Every leg is a normal served
 * session: the bandit chooses its sound, and it gets its own history record.
 */
export interface RoutineLeg {
  state: MentalState;
  /** 0..1, the setup screen's depth slider. */
  intensity: number;
  minutes: number;
}

export interface Routine {
  id: string;
  name: string;
  createdAt: string; // ISO
  legs: RoutineLeg[];
}

export const MIN_ROUTINE_LEGS = 2;
export const MAX_ROUTINE_LEGS = 5;
export const MIN_LEG_MINUTES = 1;
export const MAX_LEG_MINUTES = 240;
export const MAX_ROUTINE_NAME_LENGTH = 60;

/** What a session record remembers about the routine it was a leg of. */
export interface RoutineRef {
  id: string;
  name: string;
  /** 0-based position of this leg. */
  leg: number;
  legs: number;
}

export function isMentalState(value: unknown): value is MentalState {
  return typeof value === 'string' && value in STATES;
}

function normalizeLeg(raw: unknown): RoutineLeg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const l = raw as Partial<Record<keyof RoutineLeg, unknown>>;
  if (!isMentalState(l.state)) return null;
  const intensity = typeof l.intensity === 'number' && Number.isFinite(l.intensity) ? l.intensity : 0.5;
  const minutes = typeof l.minutes === 'number' && Number.isFinite(l.minutes) ? l.minutes : 10;
  return {
    state: l.state,
    intensity: Math.min(1, Math.max(0, intensity)),
    minutes: Math.min(MAX_LEG_MINUTES, Math.max(MIN_LEG_MINUTES, Math.round(minutes))),
  };
}

/**
 * Complete and sanitize a routine of any origin (storage, a backup, a share
 * link). Invalid legs are dropped, extra legs trimmed; null when fewer than
 * MIN_ROUTINE_LEGS valid legs remain — a one-leg routine is just a session.
 */
export function normalizeRoutine(raw: unknown): Routine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<Record<keyof Routine, unknown>>;
  const legs = (Array.isArray(r.legs) ? r.legs : [])
    .map(normalizeLeg)
    .filter((l): l is RoutineLeg => l !== null)
    .slice(0, MAX_ROUTINE_LEGS);
  if (legs.length < MIN_ROUTINE_LEGS) return null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_ROUTINE_NAME_LENGTH) : '';
  return {
    id: typeof r.id === 'string' && r.id ? r.id : `routine-${Date.now().toString(36)}`,
    name: name || 'My routine',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    legs,
  };
}

export function routineMinutes(routine: Pick<Routine, 'legs'>): number {
  return routine.legs.reduce((acc, l) => acc + l.minutes, 0);
}

/** "⚡ 10 → 🎯 50 → 🌿 5" */
export function describeRoutine(routine: Pick<Routine, 'legs'>): string {
  return routine.legs.map((l) => `${STATES[l.state].emoji} ${l.minutes}`).join(' → ');
}
