import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan,
  EXPORT_MAX_SECONDS,
  MODULATION_STEP_SEC,
} from './renderTimeline';

describe('buildRenderPlan', () => {
  it('gives sleep its 60s fade starting at duration−60 and never a chime', () => {
    const plan = buildRenderPlan({ state: 'sleep', durationSec: 1800, chimeEnabled: true });
    const fade = plan.events.find((e) => e.kind === 'endFade');
    expect(fade).toMatchObject({ time: 1740, fadeSeconds: 60 });
    expect(plan.events.some((e) => e.kind === 'chime')).toBe(false);
    expect(plan.renderSeconds).toBeCloseTo(1800.2);
  });

  it('puts the optional focus chime at the session end with a decay tail', () => {
    const plan = buildRenderPlan({ state: 'focus', durationSec: 900, chimeEnabled: true });
    const chime = plan.events.find((e) => e.kind === 'chime');
    expect(chime).toMatchObject({ time: 900 });
    expect(plan.events.find((e) => e.kind === 'endFade')).toMatchObject({
      time: 898.5,
      fadeSeconds: 1.5,
    });
    expect(plan.renderSeconds).toBeCloseTo(902.5);
  });

  it('omits the chime when the user disabled it', () => {
    const plan = buildRenderPlan({ state: 'focus', durationSec: 900, chimeEnabled: false });
    expect(plan.events.some((e) => e.kind === 'chime')).toBe(false);
    expect(plan.renderSeconds).toBeCloseTo(900.2);
  });

  it("a program's endChime overrides the state: a sleep nap export chimes", () => {
    const plan = buildRenderPlan({
      state: 'sleep',
      durationSec: 26 * 60,
      chimeEnabled: false,
      program: { endChime: true },
    });
    const chime = plan.events.find((e) => e.kind === 'chime');
    expect(chime).toMatchObject({ time: 26 * 60 });
    expect(plan.renderSeconds).toBeCloseTo(26 * 60 + 2.5);
  });

  it('schedules modulation every step from t=1, none once the fade starts', () => {
    const plan = buildRenderPlan({ state: 'sleep', durationSec: 300, chimeEnabled: false });
    const mods = plan.events.filter((e) => e.kind === 'modulation');
    expect(mods[0]?.time).toBe(MODULATION_STEP_SEC);
    for (let i = 1; i < mods.length; i++) {
      expect(mods[i].time - mods[i - 1].time).toBe(MODULATION_STEP_SEC);
    }
    const fadeStart = 300 - 60;
    expect(mods.every((e) => e.time < fadeStart)).toBe(true);
    expect(mods.at(-1)?.time).toBe(fadeStart - MODULATION_STEP_SEC);
  });

  it('caps long sessions to EXPORT_MAX_SECONDS and still ends with the fade', () => {
    for (const minutes of [90, 180]) {
      const plan = buildRenderPlan({
        state: 'relax',
        durationSec: minutes * 60,
        chimeEnabled: false,
      });
      expect(plan.capped).toBe(true);
      expect(plan.durationSec).toBe(EXPORT_MAX_SECONDS);
      expect(plan.events.find((e) => e.kind === 'endFade')?.time).toBe(
        EXPORT_MAX_SECONDS - 4, // relax fades over 4s
      );
    }
    const short = buildRenderPlan({ state: 'relax', durationSec: 3600, chimeEnabled: false });
    expect(short.capped).toBe(false);
  });

  it('emits strictly increasing event times', () => {
    const plan = buildRenderPlan({ state: 'focus', durationSec: 1500, chimeEnabled: true });
    for (let i = 1; i < plan.events.length; i++) {
      expect(plan.events[i].time).toBeGreaterThan(plan.events[i - 1].time);
    }
  });
});
