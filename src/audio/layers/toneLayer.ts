import { OscillatorPhaseTracker } from '../../export/phaseTracker';
import { ramp, RAMP_TIME_CONSTANT } from '../ramp';
import { LOWPASS_OPEN_HZ } from '../types';

/** Warmth 1 detunes the flanking oscillators by this many cents (±). */
const MAX_DETUNE_CENTS = 6;
/** Per-partial peak amplitudes at warmth 1, relative to the fundamental. */
const FLANKER_AMP = 0.35; // each of the two detuned copies of the fundamental
const PARTIAL2_AMP = 0.25;
const PARTIAL3_AMP = 0.12;
/** The per-tone lowpass never closes below this (Hz). */
const MIN_CUTOFF_HZ = 800;

/** Options for offline export — see export/phaseTracker.ts. */
export interface OscillatorLayerOptions {
  /**
   * Record every frequency/detune ramp so the chunk's oscillator phases can
   * be handed to the next chunk, and leave the oscillators stopped until
   * `start()` so their start can be delayed to match the previous chunk.
   */
  trackPhase?: boolean;
}

/**
 * Sustained tone (PRD §6A) with §7 softening: raw sines become fatiguing over
 * long sessions, so `warmth` (0..1) blends in gentle detuning (two flanking
 * oscillators a few cents off), harmonic stacking (low-level 2f and 3f
 * partials), and a per-tone lowpass. The lowpass is deliberately separate
 * from the engine's master filter, which would darken noise and ambience too.
 *
 * All partial amplitudes are equal-power normalized so warmth never changes
 * loudness — the §13 ceiling math is untouched. Level 0 keeps every
 * oscillator running silently. Warmth 0 is bit-for-bit the old pure sine.
 */
export class ToneLayer {
  /** Oscillators in tracker order: fundamental, flanker +, flanker −, 2f, 3f. */
  static readonly OSCILLATOR_COUNT = 5;

  private readonly fundamental: OscillatorNode;
  private readonly flankers: [OscillatorNode, OscillatorNode];
  private readonly partials: [OscillatorNode, OscillatorNode]; // ratios 2 and 3
  private readonly fundamentalGain: GainNode;
  private readonly flankerGain: GainNode;
  private readonly partialGains: [GainNode, GainNode];
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private frequency: number;
  private warmth = 0;
  /** Present only when tracking phase (offline export). */
  readonly trackers: OscillatorPhaseTracker[] | null;
  private started: boolean;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    frequency: number,
    opts: OscillatorLayerOptions = {},
  ) {
    this.frequency = frequency;
    const osc = (freq: number, detune = 0) =>
      new OscillatorNode(ctx, { type: 'sine', frequency: freq, detune });
    this.fundamental = osc(frequency);
    this.flankers = [osc(frequency), osc(frequency)];
    this.partials = [osc(frequency * 2), osc(frequency * 3)];
    this.trackers = opts.trackPhase
      ? [
          new OscillatorPhaseTracker(frequency),
          new OscillatorPhaseTracker(frequency),
          new OscillatorPhaseTracker(frequency),
          new OscillatorPhaseTracker(frequency * 2),
          new OscillatorPhaseTracker(frequency * 3),
        ]
      : null;
    // Realtime engines start free-running now; a tracked (offline) layer
    // waits for start() so each oscillator can be phase-aligned.
    this.started = !opts.trackPhase;
    if (this.started) for (const o of this.oscillators()) o.start();

    this.fundamentalGain = new GainNode(ctx, { gain: 1 });
    this.flankerGain = new GainNode(ctx, { gain: 0 });
    this.partialGains = [new GainNode(ctx, { gain: 0 }), new GainNode(ctx, { gain: 0 })];
    this.filter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: LOWPASS_OPEN_HZ,
      Q: 0.0001,
    });
    this.gain = new GainNode(ctx, { gain: 0 });

    this.fundamental.connect(this.fundamentalGain);
    for (const f of this.flankers) f.connect(this.flankerGain);
    this.partials[0].connect(this.partialGains[0]);
    this.partials[1].connect(this.partialGains[1]);
    for (const g of [this.fundamentalGain, this.flankerGain, ...this.partialGains]) {
      g.connect(this.filter);
    }
    this.filter.connect(this.gain).connect(destination);
  }

  private oscillators(): OscillatorNode[] {
    return [this.fundamental, ...this.flankers, ...this.partials];
  }

  /**
   * Start a tracked layer's oscillators, each `delays[i]` seconds after now
   * (tracker order). No-op for realtime layers, which started on creation.
   */
  start(delays: readonly number[] | null): void {
    if (this.started) return;
    this.started = true;
    const now = this.ctx.currentTime;
    this.oscillators().forEach((o, i) => {
      const delay = delays?.[i] ?? 0;
      o.start(now + delay);
      this.trackers?.[i].start(now + delay);
    });
  }

  setFrequency(hz: number, timeConstant: number = RAMP_TIME_CONSTANT): void {
    this.frequency = hz;
    ramp(this.ctx, this.fundamental.frequency, hz, timeConstant);
    for (const f of this.flankers) ramp(this.ctx, f.frequency, hz, timeConstant);
    ramp(this.ctx, this.partials[0].frequency, hz * 2, timeConstant);
    ramp(this.ctx, this.partials[1].frequency, hz * 3, timeConstant);
    if (this.trackers) {
      const t = this.ctx.currentTime;
      [hz, hz, hz, hz * 2, hz * 3].forEach((v, i) => this.trackers![i].setFrequency(t, v, timeConstant));
    }
    this.applyCutoff(timeConstant);
  }

  setLevel(level: number, timeConstant?: number): void {
    ramp(this.ctx, this.gain.gain, level, timeConstant);
  }

  /** PRD §7 softening amount, 0 (pure sine) .. 1 (fully warmed). */
  setCharacter(warmth: number, timeConstant: number = RAMP_TIME_CONSTANT): void {
    this.warmth = Math.min(1, Math.max(0, warmth));
    const w = this.warmth;
    const flanker = FLANKER_AMP * w;
    const p2 = PARTIAL2_AMP * w;
    const p3 = PARTIAL3_AMP * w;
    // Equal-power: total energy stays that of a single unit sine.
    const norm = 1 / Math.sqrt(1 + 2 * flanker * flanker + p2 * p2 + p3 * p3);

    ramp(this.ctx, this.flankers[0].detune, MAX_DETUNE_CENTS * w, timeConstant);
    ramp(this.ctx, this.flankers[1].detune, -MAX_DETUNE_CENTS * w, timeConstant);
    if (this.trackers) {
      const t = this.ctx.currentTime;
      this.trackers[1].setDetune(t, MAX_DETUNE_CENTS * w, timeConstant);
      this.trackers[2].setDetune(t, -MAX_DETUNE_CENTS * w, timeConstant);
    }
    ramp(this.ctx, this.fundamentalGain.gain, norm, timeConstant);
    ramp(this.ctx, this.flankerGain.gain, flanker * norm, timeConstant);
    ramp(this.ctx, this.partialGains[0].gain, p2 * norm, timeConstant);
    ramp(this.ctx, this.partialGains[1].gain, p3 * norm, timeConstant);
    this.applyCutoff(timeConstant);
  }

  /** Log-interpolated: open at warmth 0, closing toward the fundamental at 1. */
  private applyCutoff(timeConstant?: number): void {
    const closed = Math.max(2 * this.frequency, MIN_CUTOFF_HZ);
    const cutoff = Math.exp(
      Math.log(LOWPASS_OPEN_HZ) +
        (Math.log(closed) - Math.log(LOWPASS_OPEN_HZ)) * this.warmth,
    );
    ramp(this.ctx, this.filter.frequency, cutoff, timeConstant);
  }

  dispose(): void {
    for (const o of this.oscillators()) {
      // A tracked layer disposed before start() (aborted export) has nothing to stop.
      if (this.started) o.stop();
      o.disconnect();
    }
    for (const g of [this.fundamentalGain, this.flankerGain, ...this.partialGains]) {
      g.disconnect();
    }
    this.filter.disconnect();
    this.gain.disconnect();
  }
}
