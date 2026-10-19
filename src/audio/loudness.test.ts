import { describe, expect, it } from 'vitest';
import { integratedLoudness } from './loudness';

const SR = 48000;

function sine(freq: number, dbfs: number, seconds: number, sampleRate = SR): Float32Array {
  const amp = 10 ** (dbfs / 20);
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) =>
    amp * Math.sin((2 * Math.PI * freq * i) / sampleRate),
  );
}

describe('integratedLoudness (BS.1770-4)', () => {
  // EBU Tech 3341 case 1: 1 kHz stereo sine at -23 dBFS reads -23.0 LUFS.
  it('reads a -23 dBFS 1 kHz stereo sine as -23 LUFS', () => {
    const tone = sine(1000, -23, 20);
    expect(integratedLoudness([tone, tone], SR)).toBeCloseTo(-23, 1);
  });

  // Tech 3341 case 2: the same at -33 dBFS reads -33.0 LUFS.
  it('reads a -33 dBFS sine as -33 LUFS', () => {
    const tone = sine(1000, -33, 20);
    expect(integratedLoudness([tone, tone], SR)).toBeCloseTo(-33, 1);
  });

  it('is sample-rate independent', () => {
    const tone = sine(1000, -23, 20, 44100);
    expect(integratedLoudness([tone, tone], 44100)).toBeCloseTo(-23, 1);
  });

  // Tech 3341 case 3 (shape): -36 / -23 / -36 dBFS for 10 / 60 / 10 s reads
  // -23 — the quiet parts sit below the relative gate.
  it('gates out passages more than 10 LU below the programme', () => {
    const parts = [sine(1000, -36, 10), sine(1000, -23, 60), sine(1000, -36, 10)];
    const total = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      total.set(p, at);
      at += p.length;
    }
    expect(integratedLoudness([total, total], SR)).toBeCloseTo(-23, 1);
  });

  it('weights high frequencies up and low frequencies down (K-weighting)', () => {
    const at = (freq: number) => {
      const t = sine(freq, -23, 10);
      return integratedLoudness([t, t], SR);
    };
    expect(at(4000)).toBeGreaterThan(at(1000) + 3);
    expect(at(40)).toBeLessThan(at(1000) - 3);
  });

  it('a mono channel reads 3 dB below the same signal on both channels', () => {
    const tone = sine(1000, -23, 10);
    expect(integratedLoudness([tone], SR)).toBeCloseTo(-26.01, 1);
  });

  it('returns -Infinity for silence and for input shorter than one block', () => {
    const silence = new Float32Array(SR * 2);
    expect(integratedLoudness([silence, silence], SR)).toBe(-Infinity);
    const short = sine(1000, -23, 0.2);
    expect(integratedLoudness([short, short], SR)).toBe(-Infinity);
  });
});
