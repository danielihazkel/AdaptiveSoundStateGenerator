import { ramp } from './ramp';
import {
  BEATS_PER_BAR,
  MAX_PULSE_WEIGHT,
  buildBar,
  pulseWidthFraction,
  type PulseEvent,
} from './rhythm/pattern';
import type { RhythmMode } from './types';

/** Lookahead scheduling tick — "Tale of Two Clocks" pattern. */
const SCHEDULER_TICK_MS = 100;
/**
 * Schedule every pulse starting within this window. Generous enough to
 * survive background tabs throttling setInterval to once per second.
 */
const SCHEDULE_HORIZON_SEC = 1.2;
/** Segments per raised-cosine pulse envelope (linear-ramp approximation). */
const ENVELOPE_SEGMENTS = 8;

/**
 * Isochronic-style amplitude modulation (PRD §6C) with two modes.
 *
 * Simple mode (the original path, untouched): lfo (sine at `rate`) →
 * depthGain (depth/2) → input.gain, where input (base gain 1 - depth/2) sits
 * in the audio path. Effective gain oscillates between 1 - depth and 1.0.
 *
 * Pattern mode (BPM + complexity): a repeating 4-beat bar of raised-cosine
 * pulses scheduled onto patternSource.offset (0..1 envelopes), feeding
 * patternDepthGain (gain -depth) → input.gain, so gain dips 1 → 1 - depth·env.
 * Pulses are scheduled incrementally inside a short lookahead horizon and
 * in-flight envelopes are never cancelled — bpm/complexity/depth changes only
 * affect pulses not yet scheduled, which is the click-free guarantee. Accent
 * weights are normalized by MAX_PULSE_WEIGHT, so the deepest pulse dips
 * exactly `depth` and the limiter-safe invariant (gain ∈ [1 - depth, 1])
 * holds in both modes.
 *
 * Mode switches crossfade the two depth paths via ramps — no graph changes.
 */
export class PulseModulator {
  readonly input: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly depthGain: GainNode;
  private readonly patternSource: ConstantSourceNode;
  private readonly patternDepthGain: GainNode;

  private mode: RhythmMode = 'simple';
  private depth: number;
  private bpm = 80;
  private complexity = 0;

  private schedulerTimer: ReturnType<typeof setInterval> | undefined;
  private barEvents: PulseEvent[] = [];
  private eventIdx = 0;
  /** AudioContext time of barEvents[eventIdx] — the next unscheduled pulse. */
  private eventTime = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    rate: number,
    depth: number,
    /**
     * Offline (render-to-file) mode: no setInterval scheduler runs — the
     * offline driver pushes the pattern forward via scheduleAheadUntil() at
     * its suspend checkpoints instead.
     */
    private readonly offline = false,
  ) {
    this.depth = depth;
    this.input = new GainNode(ctx, { gain: 1 - depth / 2 });
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: rate });
    this.depthGain = new GainNode(ctx, { gain: depth / 2 });
    this.lfo.connect(this.depthGain).connect(this.input.gain);
    this.patternSource = new ConstantSourceNode(ctx, { offset: 0 });
    this.patternDepthGain = new GainNode(ctx, { gain: 0 });
    this.patternSource.connect(this.patternDepthGain).connect(this.input.gain);
    this.input.connect(destination);
    this.lfo.start();
    this.patternSource.start();
  }

  setRate(hz: number, timeConstant?: number): void {
    ramp(this.ctx, this.lfo.frequency, hz, timeConstant);
  }

  /** Depth 0 = no modulation (LFO keeps running silently). Simple-path knob. */
  setDepth(depth: number, timeConstant?: number): void {
    this.depth = depth;
    if (this.mode !== 'simple') return;
    ramp(this.ctx, this.depthGain.gain, depth / 2, timeConstant);
    ramp(this.ctx, this.input.gain, 1 - depth / 2, timeConstant);
  }

  /** Crossfades between the sine-LFO path and the scheduled-pattern path. */
  setMode(mode: RhythmMode, timeConstant?: number): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'pattern') {
      ramp(this.ctx, this.depthGain.gain, 0, timeConstant);
      ramp(this.ctx, this.input.gain, 1, timeConstant);
      ramp(this.ctx, this.patternDepthGain.gain, -this.depth, timeConstant);
      this.startScheduler();
    } else {
      this.stopScheduler();
      ramp(this.ctx, this.patternDepthGain.gain, 0, timeConstant);
      ramp(this.ctx, this.depthGain.gain, this.depth / 2, timeConstant);
      ramp(this.ctx, this.input.gain, 1 - this.depth / 2, timeConstant);
    }
  }

  /**
   * Pattern-path targets. bpm applies from the next unscheduled pulse,
   * complexity from the next bar; depth ramps independently of envelopes.
   */
  setPattern(bpm: number, complexity: number, depth: number, timeConstant?: number): void {
    this.bpm = Math.max(30, Math.min(200, bpm));
    this.complexity = Math.min(1, Math.max(0, complexity));
    this.depth = depth;
    if (this.mode !== 'pattern') return;
    ramp(this.ctx, this.patternDepthGain.gain, -depth, timeConstant);
  }

  dispose(): void {
    this.stopScheduler();
    this.lfo.stop();
    this.lfo.disconnect();
    this.depthGain.disconnect();
    this.patternSource.stop();
    this.patternSource.disconnect();
    this.patternDepthGain.disconnect();
    this.input.disconnect();
  }

  /**
   * Offline scheduling entry point: schedule every pattern pulse starting
   * before `until` (ctx time). Called at each offline suspend checkpoint with
   * a horizon past the next checkpoint; idempotent because eventTime only
   * advances. No-op in simple mode and in realtime engines (the interval
   * scheduler owns eventTime there — a second writer would double-schedule).
   */
  scheduleAheadUntil(until: number): void {
    if (!this.offline || this.mode !== 'pattern') return;
    this.scheduleWindow(until);
  }

  private startScheduler(): void {
    if (this.schedulerTimer !== undefined) return;
    this.barEvents = buildBar(this.complexity);
    this.eventIdx = 0;
    this.eventTime = this.ctx.currentTime + 0.05;
    if (this.offline) return; // driven externally via scheduleAheadUntil
    this.schedulerTimer = setInterval(() => this.schedulerTick(), SCHEDULER_TICK_MS);
    this.schedulerTick();
  }

  private stopScheduler(): void {
    if (this.schedulerTimer === undefined) return;
    clearInterval(this.schedulerTimer);
    this.schedulerTimer = undefined;
  }

  /** Advance to the following pulse; wraps the bar and picks up complexity. */
  private advance(): void {
    const beatDur = 60 / this.bpm;
    const current = this.barEvents[this.eventIdx];
    this.eventIdx += 1;
    if (this.eventIdx >= this.barEvents.length) {
      this.eventIdx = 0;
      this.barEvents = buildBar(this.complexity);
      this.eventTime += (BEATS_PER_BAR - current.atBeat) * beatDur;
    } else {
      this.eventTime += (this.barEvents[this.eventIdx].atBeat - current.atBeat) * beatDur;
    }
  }

  private schedulerTick(): void {
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Catch up without scheduling after suspension or a starved interval.
    while (this.eventTime < now) this.advance();
    this.scheduleWindow(now + SCHEDULE_HORIZON_SEC);
  }

  /** Schedule every pulse starting before `until`. Shared realtime/offline. */
  private scheduleWindow(until: number): void {
    while (this.eventTime < until) {
      const event = this.barEvents[this.eventIdx];
      const beatDur = 60 / this.bpm;
      const start = this.eventTime;
      this.advance();
      // Cap the envelope just short of the next pulse so envelopes never
      // overlap — overlapping automation on one AudioParam would conflict.
      const width = Math.min(
        pulseWidthFraction(this.complexity) * beatDur,
        (this.eventTime - start) * 0.95,
      );
      this.scheduleEnvelope(start, width, event.weight / MAX_PULSE_WEIGHT);
    }
  }

  /** Raised-cosine (Hann) envelope 0 → peak → 0 as linear-ramp segments. */
  private scheduleEnvelope(start: number, width: number, peak: number): void {
    const offset = this.patternSource.offset;
    offset.setValueAtTime(0, start);
    for (let k = 1; k <= ENVELOPE_SEGMENTS; k++) {
      const value = peak * 0.5 * (1 - Math.cos((2 * Math.PI * k) / ENVELOPE_SEGMENTS));
      offset.linearRampToValueAtTime(value, start + (width * k) / ENVELOPE_SEGMENTS);
    }
  }
}
