import { expect, test, type Page } from '@playwright/test';
import type { QaHooks } from '../src/dev/qaHooks';
import type { TransitionReport } from '../src/audio/signalMetrics';

/**
 * Automated "verify by ear" (TODO.md) in a real browser: renders go through
 * the actual engine on OfflineAudioContexts (src/dev/qaHooks.ts), and only
 * the metrics come back. Same yardstick as the Node worklet tests
 * (src/audio/typeSwitch.test.ts). The dip is measured against the steady
 * signal's own troughs, so pulsed states score ≈ 1 on a clean stretch;
 * the floor sits well below the lowest clean glide measured (≈ 0.7, arousal)
 * and far above a real gap (≈ 0).
 */
declare global {
  interface Window {
    __qa: QaHooks;
  }
}

const CLICK_LIMIT = 2;
const DIP_LIMIT = 0.4;
const SWELL_LIMIT = 1.3;
const STATES = [
  'focus',
  'relax',
  'sleep',
  'energy',
  'meditation',
  'arousal',
  'flow',
  'calm',
  'creative',
] as const;

function expectClean(r: TransitionReport, label: string) {
  expect(r.clickRatio, `${label} click`).toBeLessThan(CLICK_LIMIT);
  expect(r.dipRatio, `${label} dip`).toBeGreaterThan(DIP_LIMIT);
  expect(r.swellRatio, `${label} swell`).toBeLessThan(SWELL_LIMIT);
}

async function openQa(page: Page) {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('/?qa');
  await page.waitForFunction(() => window.__qa !== undefined, undefined, { timeout: 30_000 });
}

test.beforeEach(async ({ page }) => openQa(page));

for (const state of STATES) {
  test(`${state}: steady session and adaptation glides are click-free`, async ({ page }) => {
    const reports = await page.evaluate(async (s) => {
      const qa = window.__qa;
      await qa.render({ state: s, durationSec: 90 });
      const steady = qa.transition([5, 15], [15, 30], [30, 40]);
      const glides: Record<string, TransitionReport> = {};
      for (const to of ['noise-alt', 'beat-down']) {
        await qa.renderGlide({ state: s, from: 'prior', to, seconds: 20, switchAt: 8 });
        glides[to] = qa.transition([2, 7.9], [7.9, 14], [14, 19.5]);
      }
      return { steady, glides };
    }, state);
    // A whole (90 s, so arc-compressed) session moves its own level on
    // purpose — calm also breathes at 7–10 s — so only clicks are judged
    // there; the glides keep the full check.
    expect(reports.steady.clickRatio, `${state} steady click`).toBeLessThan(CLICK_LIMIT);
    for (const [to, r] of Object.entries(reports.glides)) expectClean(r, `${state} glide→${to}`);
  });
}

test('routine hand-offs glide between states click-free', async ({ page }) => {
  const reports = await page.evaluate(async () => {
    const qa = window.__qa;
    const out: Record<string, TransitionReport> = {};
    for (const [from, to] of [
      ['energy', 'focus'],
      ['focus', 'relax'],
      ['relax', 'sleep'],
    ] as const) {
      await qa.renderGlide({ state: from, toState: to, from: 'prior', to: 'prior', seconds: 26, switchAt: 8 });
      out[`${from}→${to}`] = qa.transition([2, 7.9], [7.9, 18], [18, 25.5]);
    }
    return out;
  });
  for (const [label, r] of Object.entries(reports)) {
    // Different states are different loudnesses and textures by design, so
    // only clicks and dropouts are judged across a hand-off.
    expect(r.clickRatio, `${label} click`).toBeLessThan(CLICK_LIMIT);
    expect(r.dipRatio, `${label} dip`).toBeGreaterThan(DIP_LIMIT);
  }
});

test('export chunk seams are continuous', async ({ page }) => {
  // Sleep: brown noise and long, slow sounds — where a seam is most exposed.
  const seams = await page.evaluate(async () => {
    const qa = window.__qa;
    await qa.render({ state: 'sleep', durationSec: 200, chunkSec: 60 });
    return [qa.transition([50, 59], [59, 61], [61, 70]), qa.transition([110, 119], [119, 121], [121, 130])];
  });
  seams.forEach((r, i) => expectClean(r, `seam ${i + 1}`));
});

test('the default program crosses its 3:00 phase boundary click-free', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const qa = window.__qa;
    await qa.render({ state: 'focus', durationSec: 240, program: 'default' });
    return qa.transition([150, 165], [165, 195], [195, 220]);
  });
  expectClean(r, 'program boundary');
});

test('served arms play at their state default loudness (calibrated trims)', async ({ page }) => {
  // The arms with the largest raw offsets (src/audio/loudnessTable.ts).
  const lufs = await page.evaluate(() =>
    window.__qa.measureArms({
      seconds: 24,
      intensities: [0.5],
      states: ['focus', 'sleep', 'calm'],
      arms: ['prior', 'binaural-soft', 'noise-up', 'ambience-up', 'ambience-off', 'iso-off'],
      trimmed: true,
    }),
  );
  for (const [state, arms] of Object.entries(lufs)) {
    for (const [arm, [value]] of Object.entries(arms)) {
      expect(Math.abs(value - arms.prior[0]), `${state} ${arm}`).toBeLessThan(1);
    }
  }
});

test('turning the room (space) up keeps the loudness', async ({ page }) => {
  const [dry, wet] = await page.evaluate(async () => {
    const qa = window.__qa;
    const out: number[] = [];
    for (const level of [0, 1]) {
      await qa.render({ state: 'meditation', durationSec: 40, space: { level, size: 0.6 } });
      out.push(qa.lufs([5, 30]));
    }
    return out;
  });
  expect(Math.abs(wet - dry)).toBeLessThan(1);
});

test('adaptive masking at its cap stays within +3 LU and click-free', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const qa = window.__qa;
    await qa.renderMasking({ state: 'focus', gain: 10, seconds: 40, maskAt: 10 });
    return {
      before: qa.lufs([2, 9.9]),
      after: qa.lufs([25, 39]),
      glide: qa.transition([2, 9.9], [9.9, 20], [25, 39]),
    };
  });
  const lift = report.after - report.before;
  // It does lift the beds, but never past the +3 dB cap (gain 10 is clamped).
  expect(lift).toBeGreaterThan(0.5);
  expect(lift).toBeLessThanOrEqual(3.05);
  expect(report.glide.clickRatio).toBeLessThan(CLICK_LIMIT);
});

test('a routine export hands over click-free, even with a chunk seam right on the hand-off', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const qa = window.__qa;
    // 60 s chunks: the second chunk takes over exactly where focus hands to relax.
    const { seconds } = await qa.renderRoutine({
      legs: [
        { state: 'focus', durationSec: 60 },
        { state: 'relax', durationSec: 60 },
      ],
      chunkSec: 60,
    });
    return { seconds, handoff: qa.transition([48, 57.9], [57.9, 70], [70, 110]) };
  });
  expect(report.seconds).toBeGreaterThan(119);
  // Different states differ in loudness and texture by design: judge clicks and dropouts.
  expect(report.handoff.clickRatio).toBeLessThan(CLICK_LIMIT);
  expect(report.handoff.dipRatio).toBeGreaterThan(DIP_LIMIT);
});

test('the generative melody plucks click-free, also across export chunk seams', async ({ page }) => {
  const reports = await page.evaluate(async () => {
    const qa = window.__qa;
    // The densest, brightest melody over meditation, with 60 s chunks so
    // notes straddle two seams (both engines must play the same notes).
    await qa.render({
      state: 'meditation',
      durationSec: 150,
      chunkSec: 60,
      melody: { enabled: true, level: 1, density: 8, brightness: 1 },
    });
    const windows = [
      qa.transition([5, 30], [30, 55], [55, 58]),
      qa.transition([50, 59], [59, 61], [61, 70]),
      qa.transition([110, 119], [119, 121], [121, 130]),
    ];
    const withMelody = qa.lufs([5, 140]);
    await qa.render({ state: 'meditation', durationSec: 150, chunkSec: 60 });
    return { windows, lift: withMelody - qa.lufs([5, 140]) };
  });
  // The plucks really are there (a silent layer would pass the click check)…
  expect(reports.lift).toBeGreaterThan(0.1);
  // …and never click, seams included.
  for (const [i, r] of reports.windows.entries()) {
    expect(r.clickRatio, `window ${i} click`).toBeLessThan(CLICK_LIMIT);
  }
});
