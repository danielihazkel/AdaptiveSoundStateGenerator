/** Samples per Mp3Encoder.encodeBuffer call — the MP3 frame size. */
export const MP3_BLOCK_SAMPLES = 1152;

/**
 * Convert one block of Float32 samples (from `src` starting at `offset`) to
 * signed 16-bit PCM in `out`, clamping to [-1, 1]. Returns how many samples
 * were written (short only for the final block). Asymmetric scaling (32768
 * down, 32767 up) uses the full negative range without overflow.
 */
export function floatToInt16Block(
  src: Float32Array,
  offset: number,
  out: Int16Array,
): number {
  const n = Math.max(0, Math.min(out.length, src.length - offset));
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, src[offset + i]));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return n;
}

/**
 * Interleave two channels into one 16-bit PCM buffer (L R L R …) with the
 * same scaling and clamping as the block converter — the WAV writer's path.
 */
export function interleaveInt16(left: Float32Array, right: Float32Array): Int16Array {
  const n = Math.min(left.length, right.length);
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    out[i * 2] = Math.round(l < 0 ? l * 32768 : l * 32767);
    out[i * 2 + 1] = Math.round(r < 0 ? r * 32768 : r * 32767);
  }
  return out;
}
