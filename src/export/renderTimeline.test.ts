import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan,
  CHUNK_LEAD_SEC,
  EXPORT_CHUNK_SECONDS,
  EXPORT_MAX_SECONDS,
  MODULATION_STEP_SEC,
  splitRenderPlan,
} from './renderTimeline';

describe('buildRenderPlan', () => {
  it('gives sleep its 60s fade starting at duration−60 and never a chime', () => {
    const plan = buildRenderPlan({ state: 'sleep', durationSec: 1800, chimeEnabled: true });
    const fade = plan.events.find((e) => e.kind === 'endFade');
    expect(fade).toMatchObject({ time: 1740, fadeSeconds: 60 });
    expect(plan.events.some((e) => e.kind === 'chime')).toBe(false);
    expect(plan.renderSeconds).toBeCloseTo(1800.2);
  });

  it('a wake-up sleep export ends with a 3 s fade and the chime', () => {
    const plan = buildRenderPlan({
      state: 'sleep',
      durationSec: 1800,
      chimeEnabled: false,
      wakeUp: { riseSec: 300 },
    });
    expect(plan.events.find((e) => e.kind === 'endFade')).toMatchObject({
      time: 1797,
      fadeSeconds: 3,
    });
    expect(plan.events.find((e) => e.kind === 'chime')).toMatchObject({ time: 1800 });
  });

  it('a program ignores the wake-up option', () => {
    const plan = buildRenderPlan({
      state: 'sleep',
      durationSec: 1800,
      chimeEnabled: true,
      program: {},
      wakeUp: { riseSec: 300 },
    });
    expect(plan.events.find((e) => e.kind === 'endFade')).toMatchObject({ fadeSeconds: 60 });
    expect(plan.events.some((e) => e.kind === 'chime')).toBe(false);
  });

  it('cues each phase boundary of a boundaryChime program, strictly increasing', () => {
    const plan = buildRenderPlan({
      state: 'focus',
      durationSec: 60 * 60,
      chimeEnabled: false,
      program: {
        boundaryChime: true,
        segments: [
          { startMin: 0, endMin: 25 },
          { startMin: 25, endMin: 30 },
          { startMin: 30, endMin: null },
        ] as never,
      },
    });
    const cues = plan.events.filter((e) => e.kind === 'chime').map((e) => e.time);
    expect(cues).toEqual([25 * 60 + 0.01, 30 * 60 + 0.01]);
    for (let i = 1; i < plan.events.length; i++) {
      expect(plan.events[i].time).toBeGreaterThan(plan.events[i - 1].time);
    }
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
    for (const minutes of [300, 600]) {
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

  it('allows a 3 h sleep program without capping', () => {
    const plan = buildRenderPlan({ state: 'sleep', durationSec: 3 * 3600, chimeEnabled: false });
    expect(plan.capped).toBe(false);
    expect(plan.durationSec).toBe(3 * 3600);
  });
});

describe('splitRenderPlan', () => {
  it('keeps a short plan as a single lead-less chunk identical to the plan', () => {
    const plan = buildRenderPlan({ state: 'focus', durationSec: 900, chimeEnabled: true });
    const chunks = splitRenderPlan(plan);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      index: 0,
      last: true,
      originSec: 0,
      startSec: 0,
      endSec: plan.renderSeconds,
      leadSec: 0,
      lengthSec: plan.renderSeconds,
      fadeInProgress: null,
    });
    expect(chunks[0].events).toEqual(plan.events);
  });

  it('tiles a long plan contiguously with leads that overlap the previous chunk', () => {
    const plan = buildRenderPlan({ state: 'sleep', durationSec: 50 * 60, chimeEnabled: false });
    const chunks = splitRenderPlan(plan);
    expect(chunks.length).toBe(4);
    expect(chunks[0].startSec).toBe(0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startSec).toBe(chunks[i - 1].endSec);
      expect(chunks[i].leadSec).toBe(CHUNK_LEAD_SEC);
      expect(chunks[i].originSec).toBe(chunks[i].startSec - CHUNK_LEAD_SEC);
      expect(chunks[i].lengthSec).toBeCloseTo(chunks[i].endSec - chunks[i].originSec);
      expect(chunks[i].index).toBe(i);
      expect(chunks[i].last).toBe(i === chunks.length - 1);
    }
    expect(chunks.at(-1)?.endSec).toBeCloseTo(plan.renderSeconds);
    expect(chunks[0].endSec).toBe(EXPORT_CHUNK_SECONDS);
  });

  it('re-times events into chunk time, all strictly positive and increasing', () => {
    const plan = buildRenderPlan({ state: 'relax', durationSec: 40 * 60, chimeEnabled: false });
    for (const chunk of splitRenderPlan(plan)) {
      expect(chunk.events[0]?.time).toBeGreaterThan(0);
      for (let i = 1; i < chunk.events.length; i++) {
        expect(chunk.events[i].time).toBeGreaterThan(chunk.events[i - 1].time);
      }
      for (const ev of chunk.events) {
        expect(ev.time + chunk.originSec).toBeLessThan(chunk.endSec);
      }
    }
  });

  it('places every master event in its owning chunk (lead-window events repeat)', () => {
    const plan = buildRenderPlan({ state: 'focus', durationSec: 35 * 60, chimeEnabled: true });
    const chunks = splitRenderPlan(plan);
    for (const ev of plan.events) {
      const owners = chunks.filter((c) => ev.time >= c.startSec && ev.time < c.endSec);
      expect(owners).toHaveLength(1);
      const owner = owners[0];
      expect(
        owner.events.some((e) => e.kind === ev.kind && e.time + owner.originSec === ev.time),
      ).toBe(true);
    }
    const lastChunk = chunks.at(-1)!;
    expect(lastChunk.events.some((e) => e.kind === 'endFade')).toBe(true);
    expect(lastChunk.events.some((e) => e.kind === 'chime')).toBe(true);
  });

  it("resumes sleep's 60 s fade when a chunk seam falls inside it", () => {
    // 30 min + 40 s: the fade starts at 29:40, the seam at 30:00 is 20 s in.
    const durationSec = 30 * 60 + 40;
    const plan = buildRenderPlan({ state: 'sleep', durationSec, chimeEnabled: false });
    const chunks = splitRenderPlan(plan);
    expect(chunks).toHaveLength(3);
    const last = chunks[2];
    expect(last.fadeInProgress).not.toBeNull();
    // Origin is 3 s before the seam: 17 s into the fade, 43 s remain.
    expect(last.fadeInProgress?.remainingSec).toBeCloseTo(43);
    expect(last.fadeInProgress?.gainFraction).toBeCloseTo(43 / 60);
    expect(last.events.some((e) => e.kind === 'endFade')).toBe(false);
  });

  it('folds a tiny trailing chunk into the previous one', () => {
    const plan = buildRenderPlan({
      state: 'relax',
      durationSec: EXPORT_CHUNK_SECONDS + 5,
      chimeEnabled: false,
    });
    const chunks = splitRenderPlan(plan);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].endSec).toBeCloseTo(plan.renderSeconds);
  });

  it('emits strictly increasing event times', () => {
    const plan = buildRenderPlan({ state: 'focus', durationSec: 1500, chimeEnabled: true });
    for (let i = 1; i < plan.events.length; i++) {
      expect(plan.events[i].time).toBeGreaterThan(plan.events[i - 1].time);
    }
  });
});
