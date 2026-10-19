import { describe, expect, it } from 'vitest';
import {
  AMBIENCE_PROCESSOR_NAME,
  AMBIENCE_PROCESSOR_TYPES,
  processorSource,
} from './ambience-processor';
import { AMBIENCE_TYPES } from './types';
import {
  loadWorkletProcessor,
  QA_SAMPLE_RATE as SAMPLE_RATE,
  renderSeconds,
  type ProcessorLike,
} from '../test/audioQa';

/** The real worklet source under Node (see src/test/audioQa.ts). */
const loadProcessor = () => loadWorkletProcessor(processorSource, AMBIENCE_PROCESSOR_NAME);

function stats(data: Float32Array): { peak: number; rms: number; finite: boolean } {
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) finite = false;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / data.length), finite };
}

/** RMS per 10 ms window, sorted ascending. */
function windowLevels(data: Float32Array): number[] {
  const win = Math.floor(0.01 * SAMPLE_RATE);
  const levels: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) {
    levels.push(stats(data.subarray(i, i + win)).rms);
  }
  return levels.sort((a, b) => a - b);
}

function setType(proc: ProcessorLike, type: string): void {
  proc.port.onmessage?.({ data: { type } });
  renderSeconds(proc, 0.2); // let the internal crossfade settle
}

describe('ambience processor', () => {
  it('renders every AmbienceType the profile can name', () => {
    expect([...AMBIENCE_PROCESSOR_TYPES].sort()).toEqual([...AMBIENCE_TYPES].sort());
  });

  const Processor = loadProcessor();

  for (const type of AMBIENCE_PROCESSOR_TYPES) {
    it(`${type}: bounded, finite, non-silent, decorrelated stereo`, () => {
      const proc = new Processor();
      setType(proc, type);
      const [l, r] = renderSeconds(proc, 6);
      const sl = stats(l);
      const sr = stats(r);
      expect(sl.finite && sr.finite).toBe(true);
      // Same ballpark as the original rain/ocean generators (RMS 0.12–0.35,
      // peaks up to ~1.7 before the engine's per-type trim and limiter).
      expect(sl.rms).toBeGreaterThan(0.05);
      expect(sl.rms).toBeLessThan(0.5);
      expect(sl.peak).toBeLessThan(2);
      expect(sr.peak).toBeLessThan(2);
      // Independent generator state per channel — not a dual-mono copy.
      let same = 0;
      for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same++;
      expect(same / l.length).toBeLessThan(0.5);
    });
  }

  it('event-driven types actually fire their events', () => {
    // A bird call / crackle / clink is a burst well above the bed: compare
    // the loudest 10 ms window against the median window.
    for (const type of ['forest', 'fireplace', 'cafe'] as const) {
      const proc = new Processor();
      setType(proc, type);
      const levels = windowLevels(renderSeconds(proc, 12)[0]);
      const median = levels[Math.floor(levels.length / 2)];
      const loudest = levels[levels.length - 1];
      expect(loudest / median, type).toBeGreaterThan(1.6);
    }
  });

  it('ignores unknown types', () => {
    const proc = new Processor();
    proc.port.onmessage?.({ data: { type: 'lava' } });
    expect(stats(renderSeconds(proc, 0.5)[0]).rms).toBeGreaterThan(0.05); // still rain
  });

  it('crossfades over fadeSeconds when asked, ~100 ms otherwise', () => {
    const fading = (proc: ProcessorLike) =>
      (proc as unknown as { prevType: string | null }).prevType !== null;
    const quick = new Processor();
    renderSeconds(quick, 0.2);
    quick.port.onmessage?.({ data: { type: 'fireplace' } });
    renderSeconds(quick, 0.2);
    expect(fading(quick)).toBe(false);

    const slow = new Processor();
    renderSeconds(slow, 0.2);
    slow.port.onmessage?.({ data: { type: 'fireplace', fadeSeconds: 3 } });
    renderSeconds(slow, 1);
    expect(fading(slow)).toBe(true);
    // Both generators run and blend during the fade — still a sane level.
    const mid = stats(renderSeconds(slow, 1)[0]);
    expect(mid.finite).toBe(true);
    expect(mid.rms).toBeGreaterThan(0.05);
    renderSeconds(slow, 1.2);
    expect(fading(slow)).toBe(false);
  });
});
