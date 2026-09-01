import { ramp } from './ramp';
import { generateImpulseResponse } from './reverbIr';

/**
 * Reverb send ("space", Phase 9): dry passes straight through; a parallel
 * wet path convolves the same signal with a synthesized room. Wired
 * post-pulse and pre-master by the engine, so the wet signal rides master
 * fades, the lowpass, the bass shelf, the limiter and the mono gate — and
 * deliberately bypasses the width matrix (the IR is already decorrelated,
 * and binaural must never enter the matrix).
 *
 * `size` is quantized into a handful of buckets, each a deterministic IR
 * (seeded by its bucket, so export and realtime build the same room). A
 * size change builds the next room into the idle convolver and equal-ramps
 * the pair — click-free even under a slider drag, at ≤ REVERB_SIZE_BUCKETS
 * builds. IRs are built lazily: a profile with the room off costs nothing.
 */

export const REVERB_SIZE_BUCKETS = 8;
export const REVERB_RT60_MIN_SEC = 0.6;
/** ≤ the export chunk lead (renderTimeline.ts CHUNK_LEAD_SEC = 3). */
export const REVERB_RT60_MAX_SEC = 3.0;
/** Crossfade between the two convolvers on a size change. */
const SIZE_SWITCH_TIME_CONSTANT = 0.3;

export function bucketForSize(size: number): number {
  const clamped = Math.min(1, Math.max(0, size));
  return Math.round(clamped * (REVERB_SIZE_BUCKETS - 1));
}

export function rt60ForBucket(bucket: number): number {
  return (
    REVERB_RT60_MIN_SEC +
    ((REVERB_RT60_MAX_SEC - REVERB_RT60_MIN_SEC) * bucket) / (REVERB_SIZE_BUCKETS - 1)
  );
}

export class ReverbUnit {
  private readonly convolvers: [ConvolverNode, ConvolverNode];
  private readonly convGains: [GainNode, GainNode];
  private readonly wet: GainNode;
  /** Which convolver holds the current room. */
  private active = 0;
  /** -1 = no IR built yet (space never turned on). */
  private bucket = -1;

  constructor(
    private readonly ctx: BaseAudioContext,
    source: AudioNode,
    destination: AudioNode,
  ) {
    this.wet = new GainNode(ctx, { gain: 0 });
    this.wet.connect(destination);
    this.convolvers = [new ConvolverNode(ctx), new ConvolverNode(ctx)];
    this.convGains = [new GainNode(ctx, { gain: 1 }), new GainNode(ctx, { gain: 0 })];
    for (let i = 0; i < 2; i++) {
      // A convolver with no buffer outputs silence for free, so the sends
      // can stay connected from day one.
      source.connect(this.convolvers[i]);
      this.convolvers[i].connect(this.convGains[i]).connect(this.wet);
    }
  }

  /** One ramped update per applyEffective — level is the wet mix (0..1). */
  setParams(level: number, size: number, timeConstant?: number): void {
    if (level > 0 || this.bucket !== -1) this.applyBucket(bucketForSize(size));
    ramp(this.ctx, this.wet.gain, level, timeConstant);
  }

  private applyBucket(bucket: number): void {
    if (bucket === this.bucket) return;
    const first = this.bucket === -1;
    const next = first ? this.active : 1 - this.active;
    const ir = generateImpulseResponse({
      sampleRate: this.ctx.sampleRate,
      rt60Sec: rt60ForBucket(bucket),
      seed: bucket + 1,
    });
    const buffer = this.ctx.createBuffer(2, ir.left.length, this.ctx.sampleRate);
    buffer.copyToChannel(ir.left, 0);
    buffer.copyToChannel(ir.right, 1);
    this.convolvers[next].buffer = buffer;
    if (!first) {
      ramp(this.ctx, this.convGains[next].gain, 1, SIZE_SWITCH_TIME_CONSTANT);
      ramp(this.ctx, this.convGains[this.active].gain, 0, SIZE_SWITCH_TIME_CONSTANT);
      this.active = next;
    }
    this.bucket = bucket;
  }

  dispose(): void {
    for (const node of [...this.convolvers, ...this.convGains, this.wet]) {
      node.disconnect();
    }
  }
}
