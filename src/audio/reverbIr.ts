/**
 * Synthesized reverb impulse response (Phase 9 "space") — exponentially
 * decaying decorrelated noise with a gentle lowpass tilt, from a seeded PRNG.
 * No audio files, and deterministic: the realtime engine and the offline
 * export renderer build the identical room for the same seed, so an exported
 * MP3 sounds like the live session. Keep RT60 ≤ 3 s: a chunked export's
 * 3 s lead (renderTimeline.ts CHUNK_LEAD_SEC) must fully prime the tail
 * before its seam, or the crossfade would expose a truncated reverb.
 */

export interface ImpulseResponse {
  left: Float32Array;
  right: Float32Array;
}

/** Deterministic 32-bit PRNG (mulberry32) — tiny and plenty for noise. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole lowpass cutoff of the IR noise — darker than the dry signal. */
const IR_LOWPASS_HZ = 4000;
/** Short fade-in so the IR has no impulsive onset (reads as pre-delay). */
const IR_FADE_IN_SEC = 0.005;

/**
 * Two decorrelated channels of shaped noise decaying to −60 dB at exactly
 * `rt60Sec` (the buffer is truncated there). The ConvolverNode is used with
 * normalization on, so absolute amplitude is irrelevant — only the shape.
 */
export function generateImpulseResponse(opts: {
  sampleRate: number;
  rt60Sec: number;
  seed: number;
}): ImpulseResponse {
  const { sampleRate, rt60Sec, seed } = opts;
  const length = Math.max(1, Math.round(rt60Sec * sampleRate));
  // −60 dB (×0.001) reached at the last sample.
  const decayPerSample = Math.pow(0.001, 1 / length);
  const a = Math.exp((-2 * Math.PI * IR_LOWPASS_HZ) / sampleRate);
  const fadeIn = Math.min(length, Math.max(1, Math.round(IR_FADE_IN_SEC * sampleRate)));

  const channels: [Float32Array, Float32Array] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  channels.forEach((ch, index) => {
    const rand = mulberry32(seed * 2 + index + 1);
    let env = 1;
    let lp = 0;
    for (let n = 0; n < length; n++) {
      const white = rand() * 2 - 1;
      lp = a * lp + (1 - a) * white;
      ch[n] = lp * env;
      env *= decayPerSample;
    }
    for (let n = 0; n < fadeIn; n++) ch[n] *= n / fadeIn;
  });
  return { left: channels[0], right: channels[1] };
}
