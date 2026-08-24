import { beforeEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import {
  appendSession,
  attachFeedback,
  loadPersonalization,
  loadSessions,
  markFeedbackSkipped,
  newId,
} from '../storage/storage';
import type { SessionRecord } from '../storage/types';
import {
  COLD_START_SESSIONS,
  eligibleSessionCount,
  rebuildFromSessions,
} from './bandit';
import { CANDIDATE_SET_VERSION, PRIOR_ARM_ID } from './candidates';
import {
  chooseProfile,
  resolveOutcome,
  resolvePendingOutcomes,
} from './personalizer';

function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: newId(),
    startedAt: new Date().toISOString(),
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
    servedArmId: PRIOR_ARM_ID,
    servedBy: 'prior',
    ...overrides,
  };
}

describe('chooseProfile', () => {
  it('serves the state prior during cold start', () => {
    const served = chooseProfile('focus', 0.5, 'explore');
    expect(served.servedBy).toBe('prior');
    expect(served.armId).toBe(PRIOR_ARM_ID);
    expect(served.profile).toEqual(STATES.focus.buildProfile(0.5));
  });

  it('switches to Thompson sampling after the cold start, and to the best arm when locked', () => {
    // Resolve enough full-weight sessions to pass the gate.
    for (let i = 0; i < COLD_START_SESSIONS; i++) {
      const session = makeSession({
        feedback: { rating: 4, ratedAt: new Date().toISOString() },
      });
      appendSession(session);
      resolveOutcome(session.id);
    }
    const state = loadPersonalization(CANDIDATE_SET_VERSION);
    expect(eligibleSessionCount(state, 'focus')).toBeGreaterThanOrEqual(
      COLD_START_SESSIONS,
    );

    expect(chooseProfile('focus', 0.5, 'explore').servedBy).toBe('bandit');
    const locked = chooseProfile('focus', 0.5, 'locked');
    expect(locked.servedBy).toBe('locked');
    // Only the prior arm has data (mean ≈ 0.7 > 0.5 priors) — it must win.
    expect(locked.armId).toBe(PRIOR_ARM_ID);

    // Other states are untouched by focus data — still cold.
    expect(chooseProfile('sleep', 0.5, 'explore').servedBy).toBe('prior');
  });
});

describe('resolveOutcome', () => {
  it('serve → record → rate → resolve updates exactly one arm exactly once', () => {
    const session = makeSession();
    appendSession(session);
    attachFeedback(session.id, 5);

    resolveOutcome(session.id);
    const after = loadPersonalization(CANDIDATE_SET_VERSION);
    expect(Object.keys(after.arms.focus ?? {})).toEqual([PRIOR_ARM_ID]);
    const stats = after.arms.focus![PRIOR_ARM_ID];
    expect(stats.n).toBe(1);

    // Idempotent: a second resolution (any path) must not double-count.
    resolveOutcome(session.id);
    expect(loadPersonalization(CANDIDATE_SET_VERSION).arms.focus![PRIOR_ARM_ID].n).toBe(1);
    expect(loadSessions()[0].banditResolvedAt).toBeTruthy();
  });

  it('stamps preset sessions resolved without updating any arm', () => {
    const session = makeSession({ servedBy: 'preset', presetId: 'p1' });
    appendSession(session);
    resolveOutcome(session.id);
    expect(loadPersonalization(CANDIDATE_SET_VERSION).arms).toEqual({});
    expect(loadSessions()[0].banditResolvedAt).toBeTruthy();
  });

  it('ignores unknown ids and records without a served arm', () => {
    const legacy = makeSession({ servedArmId: undefined, servedBy: undefined });
    appendSession(legacy);
    expect(() => resolveOutcome('nope')).not.toThrow();
    resolveOutcome(legacy.id);
    expect(loadSessions()[0].banditResolvedAt).toBeUndefined();
  });
});

describe('resolvePendingOutcomes', () => {
  it('resolves rated, skipped, and expired sessions; leaves fresh unrated ones', () => {
    const now = new Date('2026-08-23T08:00:00.000Z');
    const ratedSession = makeSession({
      startedAt: '2026-08-23T06:00:00.000Z',
      feedback: { rating: 4, ratedAt: '2026-08-23T07:00:00.000Z' },
    });
    const skippedSession = makeSession({
      startedAt: '2026-08-23T06:00:00.000Z',
      feedbackSkipped: true,
    });
    // Expired sleep session from two nights ago — counts implicit-only.
    const expiredSleep = makeSession({
      state: 'sleep',
      startedAt: '2026-08-21T22:00:00.000Z',
      profile: STATES.sleep.buildProfile(0.5),
    });
    // Completed last night, still inside the morning-prompt window.
    const pendingSleep = makeSession({
      state: 'sleep',
      startedAt: '2026-08-22T23:00:00.000Z',
      profile: STATES.sleep.buildProfile(0.5),
    });
    for (const s of [ratedSession, skippedSession, expiredSleep, pendingSleep]) {
      appendSession(s);
    }

    resolvePendingOutcomes(now);

    const byId = new Map(loadSessions().map((s) => [s.id, s]));
    expect(byId.get(ratedSession.id)!.banditResolvedAt).toBeTruthy();
    expect(byId.get(skippedSession.id)!.banditResolvedAt).toBeTruthy();
    expect(byId.get(expiredSleep.id)!.banditResolvedAt).toBeTruthy();
    expect(byId.get(pendingSleep.id)!.banditResolvedAt).toBeUndefined();

    const state = loadPersonalization(CANDIDATE_SET_VERSION);
    // focus: 1 rated (weight 1) + 1 skipped implicit (0.6); sleep: 1 implicit (0.6).
    expect(eligibleSessionCount(state, 'focus')).toBeCloseTo(1.6, 10);
    expect(eligibleSessionCount(state, 'sleep')).toBeCloseTo(0.6, 10);
  });

  it('is a no-op on a second run', () => {
    const session = makeSession({ feedbackSkipped: true });
    appendSession(session);
    resolvePendingOutcomes();
    const once = loadPersonalization(CANDIDATE_SET_VERSION);
    resolvePendingOutcomes();
    expect(loadPersonalization(CANDIDATE_SET_VERSION)).toEqual(once);
  });
});

describe('segmented sessions (Phase 3)', () => {
  function adaptedSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
    return makeSession({
      feedback: { rating: 4, ratedAt: new Date().toISOString() },
      segments: [
        {
          armId: PRIOR_ARM_ID,
          startSec: 0,
          endSec: 600,
          response: 'worse',
          volumeAdjustments: 0,
          trigger: 'initial',
        },
        {
          armId: 'beat-down',
          startSec: 600,
          endSec: 1800,
          volumeAdjustments: 0,
          trigger: 'explicit',
        },
      ],
      ...overrides,
    });
  }

  it('credits every segment arm under a single idempotency stamp', () => {
    const session = adaptedSession();
    appendSession(session);
    resolveOutcome(session.id);

    const arms = loadPersonalization(CANDIDATE_SET_VERSION).arms.focus!;
    // Checkpoint credit on the prior, end-of-session credit on beat-down.
    expect(Object.keys(arms).sort()).toEqual(['beat-down', PRIOR_ARM_ID].sort());
    const once = { prior: arms[PRIOR_ARM_ID].n, beatDown: arms['beat-down'].n };

    resolveOutcome(session.id); // must not double-count any credit
    const after = loadPersonalization(CANDIDATE_SET_VERSION).arms.focus!;
    expect(after[PRIOR_ARM_ID].n).toBe(once.prior);
    expect(after['beat-down'].n).toBe(once.beatDown);
  });

  it('rebuildFromSessions replays segmented records identically', () => {
    const sessions = [adaptedSession(), makeSession({ feedbackSkipped: true })];
    for (const s of sessions) {
      appendSession(s);
      resolveOutcome(s.id);
    }
    const incremental = loadPersonalization(CANDIDATE_SET_VERSION);
    const rebuilt = rebuildFromSessions(loadSessions());
    expect(rebuilt.arms).toEqual(incremental.arms);
  });
});

describe('skip signal round-trip', () => {
  it('markFeedbackSkipped then resolve counts the session implicit-only', () => {
    const session = makeSession();
    appendSession(session);
    markFeedbackSkipped(session.id);
    resolveOutcome(session.id);
    const stats = loadPersonalization(CANDIDATE_SET_VERSION).arms.focus![PRIOR_ARM_ID];
    expect(stats.n).toBeCloseTo(0.6, 10); // implicit-only weight
  });
});
