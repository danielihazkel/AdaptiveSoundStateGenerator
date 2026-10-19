import { expect } from 'vitest';
import {
  analyzeTransition as analyzeAt,
  windowRms as windowRmsAt,
  type TransitionReport,
} from '../audio/signalMetrics';

export { maxIsolatedStep, maxStep, median, rms, type TransitionReport } from '../audio/signalMetrics';

/**
 * Automated stand-ins for "verify by ear" under Node: a worklet harness that
 * runs the real processor source, with the shared signal metrics
 * (src/audio/signalMetrics.ts) bound to its sample rate.
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

export function windowRms(data: Float32Array, windowSec = 0.01): number[] {
  return windowRmsAt(data, QA_SAMPLE_RATE, windowSec);
}

export function analyzeTransition(
  before: Float32Array,
  transition: Float32Array,
  after: Float32Array,
): TransitionReport {
  return analyzeAt(before, transition, after, QA_SAMPLE_RATE);
}
