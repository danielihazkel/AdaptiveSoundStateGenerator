import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import {
  CANDIDATE_SET_VERSION,
  PRIOR_ARM_ID,
} from '../personalization/candidates';
import { SCHEMA_VERSION, type PersonalizationState } from '../storage/types';
import {
  decideAdaptation,
  MAX_SWITCHES_PER_SESSION,
  SOFTEN_NOISE_FACTOR,
  SOFTEN_PULSE_DEPTH_FACTOR,
  softenProfile,
  type AdaptationInput,
} from './adaptation';
import type { SegmentObservation } from './types';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296; // (0, 1) — never exactly 0
  };
}

function emptyPersonalization(): PersonalizationState {
  return {
    schemaVersion: SCHEMA_VERSION,
    candidateSetVersion: CANDIDATE_SET_VERSION,
    arms: {},
  };
}

function observation(overrides: Partial<SegmentObservation> = {}): SegmentObservation {
  return {
    response: null,
    volumeTweaksInSegment: 0,
    customizedInSegment: false,
    hrTrend: null,
    ...overrides,
  };
}

function input(overrides: Partial<AdaptationInput> = {}): AdaptationInput {
  return {
    state: 'focus',
    mode: 'explore',
    currentArmId: PRIOR_ARM_ID,
    previousArmIds: [],
    likedArmIds: [],
    switchesSoFar: 0,
    softenedAlready: false,
    observation: observation(),
    personalization: emptyPersonalization(),
    rng: lcg(7),
    ...overrides,
  };
}

describe('decideAdaptation', () => {
  it('stays on better/same responses', () => {
    expect(
      decideAdaptation(input({ observation: observation({ response: 'better' }) })),
    ).toEqual({ kind: 'stay' });
    expect(
      decideAdaptation(input({ observation: observation({ response: 'same' }) })),
    ).toEqual({ kind: 'stay' });
  });

  it('worse with no history switches to an untried arm', () => {
    const action = decideAdaptation(
      input({ observation: observation({ response: 'worse' }) }),
    );
    expect(action.kind).toBe('switch');
    if (action.kind === 'switch') {
      expect(action.armId).not.toBe(PRIOR_ARM_ID);
      expect(action.trigger).toBe('explicit');
    }
  });

  it('resampling excludes every previously tried arm', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const previous = ['beat-down', 'beat-up', 'carrier-low'];
      const action = decideAdaptation(
        input({
          currentArmId: 'noise-alt',
          previousArmIds: previous,
          observation: observation({ response: 'worse' }),
          rng: lcg(seed),
        }),
      );
      if (action.kind === 'switch') {
        expect([...previous, 'noise-alt']).not.toContain(action.armId);
      }
    }
  });

  it('worse reverts to the most recent previously-liked arm', () => {
    const action = decideAdaptation(
      input({
        currentArmId: 'beat-up',
        previousArmIds: [PRIOR_ARM_ID, 'beat-down'],
        likedArmIds: [PRIOR_ARM_ID, 'beat-down'],
        observation: observation({ response: 'worse' }),
      }),
    );
    expect(action).toEqual({ kind: 'revert', armId: 'beat-down' });
  });

  it('revert ignores the switch cap', () => {
    const action = decideAdaptation(
      input({
        currentArmId: 'beat-up',
        previousArmIds: [PRIOR_ARM_ID],
        likedArmIds: [PRIOR_ARM_ID],
        switchesSoFar: MAX_SWITCHES_PER_SESSION,
        observation: observation({ response: 'worse' }),
      }),
    );
    expect(action).toEqual({ kind: 'revert', armId: PRIOR_ARM_ID });
  });

  it('holds steady once the switch cap is reached and nothing is liked', () => {
    const action = decideAdaptation(
      input({
        switchesSoFar: MAX_SWITCHES_PER_SESSION,
        observation: observation({ response: 'worse' }),
      }),
    );
    expect(action).toEqual({ kind: 'stay' });
  });

  it('dismissed prompt switches only on strong implicit signals', () => {
    expect(
      decideAdaptation(input({ observation: observation({ volumeTweaksInSegment: 1 }) })),
    ).toEqual({ kind: 'stay' });

    const tweaks = decideAdaptation(
      input({ observation: observation({ volumeTweaksInSegment: 2 }) }),
    );
    expect(tweaks.kind).toBe('switch');
    if (tweaks.kind === 'switch') expect(tweaks.trigger).toBe('implicit');
  });

  it('adverse HR triggers a biometric switch for relax and calm, never for focus or flow', () => {
    for (const state of ['relax', 'calm'] as const) {
      const action = decideAdaptation(
        input({ state, observation: observation({ hrTrend: 'rising' }) }),
      );
      expect(action.kind).toBe('switch');
      if (action.kind === 'switch') expect(action.trigger).toBe('biometric');
    }

    for (const state of ['focus', 'flow'] as const) {
      expect(
        decideAdaptation(
          input({ state, observation: observation({ hrTrend: 'rising' }) }),
        ),
      ).toEqual({ kind: 'stay' });
    }
  });

  it('customization always wins: stay even on worse', () => {
    expect(
      decideAdaptation(
        input({
          observation: observation({ response: 'worse', customizedInSegment: true }),
        }),
      ),
    ).toEqual({ kind: 'stay' });
  });

  it('locked mode never explores: implicit signals stay, worse falls back to prior', () => {
    expect(
      decideAdaptation(
        input({ mode: 'locked', observation: observation({ volumeTweaksInSegment: 5 }) }),
      ),
    ).toEqual({ kind: 'stay' });

    const worse = decideAdaptation(
      input({
        mode: 'locked',
        currentArmId: 'beat-up',
        observation: observation({ response: 'worse' }),
      }),
    );
    expect(worse).toEqual({ kind: 'switch', armId: PRIOR_ARM_ID, trigger: 'explicit' });

    // Already on the prior with nothing liked — nowhere safe to go.
    expect(
      decideAdaptation(
        input({ mode: 'locked', observation: observation({ response: 'worse' }) }),
      ),
    ).toEqual({ kind: 'stay' });
  });

  it('sleep never switches arms; rising HR softens exactly once', () => {
    expect(
      decideAdaptation(
        input({ state: 'sleep', observation: observation({ volumeTweaksInSegment: 5 }) }),
      ),
    ).toEqual({ kind: 'stay' });

    expect(
      decideAdaptation(
        input({ state: 'sleep', observation: observation({ hrTrend: 'rising' }) }),
      ),
    ).toEqual({ kind: 'soften' });

    expect(
      decideAdaptation(
        input({
          state: 'sleep',
          softenedAlready: true,
          observation: observation({ hrTrend: 'rising' }),
        }),
      ),
    ).toEqual({ kind: 'stay' });
  });
});

describe('softenProfile', () => {
  it('quiets noise and shallows the pulse without touching anything else', () => {
    const before = STATES.sleep.buildProfile(0.5);
    const after = softenProfile(before);
    expect(after.noise.level).toBeCloseTo(before.noise.level * SOFTEN_NOISE_FACTOR, 5);
    expect(after.isochronic.depth).toBeCloseTo(
      before.isochronic.depth * SOFTEN_PULSE_DEPTH_FACTOR,
      5,
    );
    expect(after.masterVolume).toBe(before.masterVolume);
    expect(after.binaural).toEqual(before.binaural);
  });
});
