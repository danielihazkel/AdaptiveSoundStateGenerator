import { expect } from 'vitest';

/**
 * Automated stand-ins for "verify by ear": a worklet harness that runs the
 * real processor source under Node, plus signal metrics that catch clicks
 * and dropouts without needing a listener.
 */

export const QA_SAMPLE_RATE = 44100;

export interface ProcessorLike {
  port: { onmessage: ((e: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

/** Deterministic Math.random replacement (LCG) so signal tests never flake. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/**
 * Evaluates a worklet's source under Node with the AudioWorklet globals
 * stubbed and returns the registered processor class. With `seed`, the
 * source sees a Math whose random() is seeded — the generators are plain
 * math, so this exercises exactly the code path the browser runs.
 */
export function loadWorkletProcessor(
  source: string,
  expectedName: string,
  seed?: number,
): new () => ProcessorLike {
  let registered: unknown;
  class AudioWorkletProcessor {
    port = { onmessage: null as ((e: { data: unknown }) => void) | null };
  }
  const math = seed === undefined ? Math : Object.assign(Object.create(Math), { random: seededRandom(seed) });
  const factory = new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'Math', source);
  factory(QA_SAMPLE_RATE, AudioWorkletProcessor, (name: string, cls: unknown) => {
    expect(name).toBe(expectedName);
    registered = cls;
  }, math);
  return registered as new () => ProcessorLike;
}

export function renderSeconds(proc: ProcessorLike, seconds: number): [Float32Array, Float32Array] {
  const frames = Math.floor((seconds * QA_SAMPLE_RATE) / 128);
  const out: [Float32Array, Float32Array] = [new Float32Array(frames * 128), new Float32Array(frames * 128)];
  const block = [new Float32Array(128), new Float32Array(128)];
  for (let f = 0; f < frames; f++) {
    block[0].fill(0);
    block[1].fill(0);
    if (!proc.process([], [block])) throw new Error('processor asked to stop');
    out[0].set(block[0], f * 128);
    out[1].set(block[1], f * 128);
  }
  return out;
}

export function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/** Largest sample-to-sample step — where a click lives. */
export function maxStep(data: Float32Array): number {
  let peak = 0;
  for (let i = 1; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - data[i - 1]));
  return peak;
}

/**
 * Largest *isolated* step: each sample step divided by the mean step size
 * in the ~6 ms around it (the step itself and its immediate neighbours
 * excluded). A click is a jump the surrounding signal doesn't explain —
 * it scores high even inside loud material — while a bird chirp or a
 * crackle is sustained high-frequency energy and scores like its
 * neighbourhood.
 */
export function maxIsolatedStep(data: Float32Array, halfWindow = 128): number {
  const n = data.length;
  if (n < 2) return 0;
  const steps = new Float64Array(n);
  for (let i = 1; i < n; i++) steps[i] = Math.abs(data[i] - data[i - 1]);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + steps[i];
  let peak = 0;
  for (let i = 1; i < n; i++) {
    const lo = Math.max(1, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    const nearLo = Math.max(lo, i - 2);
    const nearHi = Math.min(hi, i + 2);
    const sum = prefix[hi + 1] - prefix[lo] - (prefix[nearHi + 1] - prefix[nearLo]);
    const count = hi - lo + 1 - (nearHi - nearLo + 1);
    if (count <= 0) continue;
    const local = sum / count;
    if (local > 1e-9) peak = Math.max(peak, steps[i] / local);
  }
  return peak;
}

/** RMS of consecutive windows of `windowSec`. */
export function windowRms(data: Float32Array, windowSec = 0.01): number[] {
  const win = Math.max(1, Math.floor(windowSec * QA_SAMPLE_RATE));
  const levels: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) levels.push(rms(data.subarray(i, i + win)));
  return levels;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export interface TransitionReport {
  /**
   * Most isolated step inside the transition over the most isolated step of
   * either steady state (see maxIsolatedStep). A blend of two clean signals
   * stays near 1; a discontinuity stands far above.
   */
  clickRatio: number;
  /** Quietest 10 ms window in the transition over the quieter steady bed: a dropout shows as ≪ 1. */
  dipRatio: number;
  /** Loudest 10 ms window over the louder steady bed: a pop shows as ≫ 1. */
  swellRatio: number;
}

/** Compare a transition against the steady signal on either side of it. */
export function analyzeTransition(
  before: Float32Array,
  transition: Float32Array,
  after: Float32Array,
): TransitionReport {
  const bedBefore = median(windowRms(before));
  const bedAfter = median(windowRms(after));
  const levels = windowRms(transition);
  return {
    clickRatio: maxIsolatedStep(transition) / Math.max(maxIsolatedStep(before), maxIsolatedStep(after)),
    dipRatio: Math.min(...levels) / Math.min(bedBefore, bedAfter),
    swellRatio: Math.max(...levels) / Math.max(...windowRms(before), ...windowRms(after)),
  };
}
