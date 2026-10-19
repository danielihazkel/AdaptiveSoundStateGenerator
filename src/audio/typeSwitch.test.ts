import { describe, expect, it } from 'vitest';
import {
  analyzeTransition,
  loadWorkletProcessor,
  rms,
  renderSeconds,
  seededRandom,
} from '../test/audioQa';
import {
  AMBIENCE_PROCESSOR_NAME,
  AMBIENCE_PROCESSOR_TYPES,
  processorSource as ambienceSource,
} from './ambience-processor';
import { NOISE_PROCESSOR_NAME, processorSource as noiseSource } from './noise-processor';
import { NOISE_TYPES } from './types';
import { PROGRAM_TYPE_FADE_SEC } from '../programs/evaluator';
import { TYPE_FADE_SECONDS } from './mixPolicy';

/**
 * Automated "verify by ear" for noise-colour and ambience-type switches
 * (TODO Phase 9 / cross-cutting): every switch, at the slider fade and the
 * program fade, must be free of clicks, dropouts and pops. Thresholds come
 * from measurement — clean switches score click ≤ 1.35, dip ≥ 0.5, swell
 * ≤ 1.05; the limits leave margin while the self-tests below prove an actual
 * defect lands far outside them.
 */
const CLICK_LIMIT = 2;
const DIP_LIMIT = 0.35;
const SWELL_LIMIT = 1.3;

function switchReport(source: string, name: string, from: string, to: string, fadeSeconds: number) {
  const Processor = loadWorkletProcessor(source, name, 7);
  const proc = new Processor();
  // The steady references are at least as long as the transition: slow
  // textures (ocean swells) and sparse events (crackles) must get the same
  // chance to peak on either side as inside the fade.
  const steadySec = Math.max(2, fadeSeconds + 0.05);
  proc.port.onmessage?.({ data: { type: from } });
  renderSeconds(proc, 0.5);
  const before = renderSeconds(proc, steadySec)[0];
  proc.port.onmessage?.({ data: { type: to, fadeSeconds } });
  const transition = renderSeconds(proc, fadeSeconds + 0.05)[0];
  renderSeconds(proc, 0.2);
  const after = renderSeconds(proc, steadySec)[0];
  return analyzeTransition(before, transition, after);
}

function expectClean(report: ReturnType<typeof analyzeTransition>, label: string) {
  expect(report.clickRatio, `${label} click`).toBeLessThan(CLICK_LIMIT);
  expect(report.dipRatio, `${label} dip`).toBeGreaterThan(DIP_LIMIT);
  expect(report.swellRatio, `${label} swell`).toBeLessThan(SWELL_LIMIT);
}

describe('transition analysis (self-test)', () => {
  // Smooth, stationary reference signal (leaky-integrated noise), deterministic.
  const walk = (n: number, seed: number) => {
    const rnd = seededRandom(seed);
    const out = new Float32Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = 0.9 * v + (rnd() - 0.5) * 0.05;
      out[i] = v;
    }
    return out;
  };

  it('passes a clean continuation', () => {
    const signal = walk(44100 * 3, 1);
    expectClean(
      analyzeTransition(signal.subarray(0, 44100), signal.subarray(44100, 88200), signal.subarray(88200)),
      'clean',
    );
  });

  it('flags a hard step as a click', () => {
    const signal = walk(44100 * 3, 2);
    for (let i = 66150; i < 88200; i++) signal[i] += 0.5; // DC jump mid-transition
    const r = analyzeTransition(signal.subarray(0, 44100), signal.subarray(44100, 88200), signal.subarray(88200));
    expect(r.clickRatio).toBeGreaterThan(CLICK_LIMIT * 2);
  });

  it('flags a dropout and a pop', () => {
    const signal = walk(44100 * 3, 3);
    signal.fill(0, 50000, 50000 + 882); // 20 ms of silence
    signal.fill(0.9, 70000, 70000 + 441); // 10 ms burst
    const r = analyzeTransition(signal.subarray(0, 44100), signal.subarray(44100, 88200), signal.subarray(88200));
    expect(r.dipRatio).toBeLessThan(DIP_LIMIT / 10);
    expect(r.swellRatio).toBeGreaterThan(SWELL_LIMIT);
  });
});

describe('transition analysis (negative control)', () => {
  // Sensitivity, measured on real brown noise (the smoothest colour, where a
  // click is most exposed): the score grows ~2.2 per σ of injected step, so
  // CLICK_LIMIT catches discontinuities from ~1σ up. A hard cut *into*
  // pink/white/blue is masked by those colours' own roughness — to the ear
  // as well as to the metric.
  it('flags a 2σ step in real brown noise', () => {
    const Processor = loadWorkletProcessor(noiseSource, NOISE_PROCESSOR_NAME, 3);
    const proc = new Processor();
    proc.port.onmessage?.({ data: { type: 'brown' } });
    renderSeconds(proc, 0.5);
    const signal = renderSeconds(proc, 3)[0];
    const step = 2 * rms(signal);
    for (let i = 66150; i < 88200; i++) signal[i] += step;
    const r = analyzeTransition(signal.subarray(0, 44100), signal.subarray(44100, 88200), signal.subarray(88200));
    expect(r.clickRatio).toBeGreaterThan(CLICK_LIMIT * 1.5);
  });
});

describe('noise colour switches are click-free', () => {
  for (const from of NOISE_TYPES) {
    for (const to of NOISE_TYPES) {
      if (from === to) continue;
      for (const fade of [TYPE_FADE_SECONDS, PROGRAM_TYPE_FADE_SEC]) {
        it(`${from} → ${to} over ${fade} s`, () => {
          expectClean(switchReport(noiseSource, NOISE_PROCESSOR_NAME, from, to, fade), `${from}→${to}`);
        });
      }
    }
  }
});

describe('ambience type switches are click-free', () => {
  const types = [...AMBIENCE_PROCESSOR_TYPES];
  for (const from of types) {
    for (const to of types) {
      if (from === to) continue;
      it(`${from} → ${to} over ${TYPE_FADE_SECONDS} s`, () => {
        expectClean(
          switchReport(ambienceSource, AMBIENCE_PROCESSOR_NAME, from, to, TYPE_FADE_SECONDS),
          `${from}→${to}`,
        );
      });
    }
  }
  // The long program dissolve, once per type (each into the next).
  types.forEach((from, i) => {
    const to = types[(i + 1) % types.length];
    it(`${from} → ${to} over ${PROGRAM_TYPE_FADE_SEC} s`, () => {
      expectClean(
        switchReport(ambienceSource, AMBIENCE_PROCESSOR_NAME, from, to, PROGRAM_TYPE_FADE_SEC),
        `${from}→${to}`,
      );
    });
  });
});
