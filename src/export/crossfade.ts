/**
 * Equal-power crossfade of `prev` into `next`, written in place into `next`
 * (both the same length). Chunk seams join two independent renders whose
 * noise/ambience are uncorrelated, and whose oscillators sit at unrelated
 * phases — equal-power (cos²+sin² = 1) keeps the perceived level steady for
 * uncorrelated material; a linear fade would dip ~3 dB mid-seam.
 */
export function mixOverlap(prev: Float32Array, next: Float32Array): void {
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const theta = ((i + 0.5) / n) * (Math.PI / 2);
    next[i] = prev[i] * Math.cos(theta) + next[i] * Math.sin(theta);
  }
}
