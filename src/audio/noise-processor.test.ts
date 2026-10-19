import { describe, expect, it } from 'vitest';
import { loadWorkletProcessor, renderSeconds, rms } from '../test/audioQa';
import { NOISE_PROCESSOR_NAME, processorSource } from './noise-processor';

const loadProcessor = () => loadWorkletProcessor(processorSource, NOISE_PROCESSOR_NAME);

/** Lag-1 autocorrelation: ~0 for white, → 1 for brown. A colour fingerprint. */
function lag1(data: Float32Array): number {
  let num = 0;
  let den = 0;
  for (let i = 1; i < data.length; i++) {
    num += data[i] * data[i - 1];
    den += data[i] * data[i];
  }
  return num / den;
}

describe('noise processor', () => {
  const Processor = loadProcessor();

  for (const type of ['white', 'pink', 'brown', 'blue'] as const) {
    it(`${type}: bounded, finite, non-silent, decorrelated stereo`, () => {
      const proc = new Processor();
      proc.port.onmessage?.({ data: { type } });
      renderSeconds(proc, 0.3);
      const [l, r] = renderSeconds(proc, 2);
      expect(l.every(Number.isFinite)).toBe(true);
      expect(rms(l)).toBeGreaterThan(0.05);
      let peak = 0;
      for (const v of l) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThan(2);
      let same = 0;
      for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same++;
      expect(same / l.length).toBeLessThan(0.01);
    });
  }

  it('has the expected colour fingerprints', () => {
    const fingerprint = (type: string) => {
      const proc = new Processor();
      proc.port.onmessage?.({ data: { type } });
      renderSeconds(proc, 0.3);
      return lag1(renderSeconds(proc, 2)[0]);
    };
    expect(Math.abs(fingerprint('white'))).toBeLessThan(0.05);
    expect(fingerprint('brown')).toBeGreaterThan(0.95);
    expect(fingerprint('blue')).toBeLessThan(-0.3);
    const pink = fingerprint('pink');
    expect(pink).toBeGreaterThan(0.3);
    expect(pink).toBeLessThan(0.95);
  });

  it('switches colour within ~100 ms by default', () => {
    const proc = new Processor();
    renderSeconds(proc, 0.2); // white
    proc.port.onmessage?.({ data: { type: 'brown' } });
    renderSeconds(proc, 0.2);
    expect(lag1(renderSeconds(proc, 1)[0])).toBeGreaterThan(0.95);
  });

  it('glides over fadeSeconds with a monotone, equal-power blend', () => {
    const proc = new Processor();
    renderSeconds(proc, 0.2); // white
    proc.port.onmessage?.({ data: { type: 'brown', fadeSeconds: 2 } });
    // Sample the blend at 0.5 s steps: the brown fingerprint must rise
    // steadily, and the level must never dip below both endpoints.
    const fingerprints: number[] = [];
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      const chunk = renderSeconds(proc, 0.5)[0];
      fingerprints.push(lag1(chunk));
      levels.push(rms(chunk));
    }
    for (let i = 1; i < fingerprints.length; i++) {
      expect(fingerprints[i]).toBeGreaterThan(fingerprints[i - 1]);
    }
    expect(fingerprints[0]).toBeLessThan(0.6);
    // Fade over: pure brown from here.
    const after = renderSeconds(proc, 1)[0];
    expect(lag1(after)).toBeGreaterThan(0.95);
    const white = 1 / Math.sqrt(3);
    const brown = rms(after);
    for (const level of levels) {
      expect(level).toBeGreaterThan(Math.min(white, brown) * 0.9);
      expect(level).toBeLessThan(Math.max(white, brown) * 1.1);
    }
  });

  it('ignores unknown types and bad fade values', () => {
    const proc = new Processor();
    proc.port.onmessage?.({ data: { type: 'purple' } });
    proc.port.onmessage?.({ data: { type: 'brown', fadeSeconds: -1 } });
    renderSeconds(proc, 0.2);
    expect(lag1(renderSeconds(proc, 1)[0])).toBeGreaterThan(0.95); // default fade applied
  });
});
