/**
 * Integrated loudness per ITU-R BS.1770-4 / EBU R 128 (LUFS), over raw
 * Float32 channels. Pure — runs in Node tests and on rendered offline
 * buffers in the browser alike.
 *
 * K-weighting is the standard two-stage pre-filter (a high-shelf "head"
 * stage and an RLB high-pass), with coefficients derived for any sample
 * rate via the bilinear transform. Loudness is gated: 400 ms blocks at 75 %
 * overlap, an absolute gate at −70 LUFS, then a relative gate 10 LU below
 * the ungated mean.
 */

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Stage 1: the high-shelf modelling the head (+4 dB above ~1.5 kHz). */
function shelf(sampleRate: number): Biquad {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/** Stage 2: the RLB high-pass (~38 Hz). */
function highpass(sampleRate: number): Biquad {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function filter(input: ArrayLike<number>, c: Biquad): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function kWeighted(channel: Float32Array, sampleRate: number): Float64Array {
  return filter(filter(channel, shelf(sampleRate)), highpass(sampleRate));
}

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = 10;
const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/**
 * Integrated loudness of the channels (all channel weights 1 — L/R stereo
 * or mono). Returns -Infinity for silence or input shorter than one block.
 */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  if (channels.length === 0) return -Infinity;
  const length = Math.min(...channels.map((c) => c.length));
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  if (length < block) return -Infinity;
  // Prefix sums of the K-weighted power, summed over channels.
  const prefix = new Float64Array(length + 1);
  const weighted = channels.map((c) => kWeighted(c.subarray(0, length), sampleRate));
  for (let i = 0; i < length; i++) {
    let p = 0;
    for (const w of weighted) p += w[i] * w[i];
    prefix[i + 1] = prefix[i] + p;
  }
  const blocks: number[] = [];
  for (let start = 0; start + block <= length; start += hop) {
    blocks.push((prefix[start + block] - prefix[start]) / block);
  }
  const absGated = blocks.filter((z) => z > 0 && toLufs(z) > ABSOLUTE_GATE_LUFS);
  if (absGated.length === 0) return -Infinity;
  const ungated = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const threshold = toLufs(ungated) - RELATIVE_GATE_LU;
  const gated = absGated.filter((z) => toLufs(z) > threshold);
  return toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}
