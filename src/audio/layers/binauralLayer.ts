import { OscillatorPhaseTracker } from '../../export/phaseTracker';
import { ramp, RAMP_TIME_CONSTANT } from '../ramp';
import type { OscillatorLayerOptions } from './toneLayer';

/**
 * Binaural beat pair (PRD §6B): left = carrier - beat/2, right = carrier + beat/2.
 * Oscillators are hard-routed to separate channels; beat changes glide via
 * ramped frequency updates rather than switching abruptly.
 */
export class BinauralLayer {
  /** Oscillators in tracker order: left, right. */
  static readonly OSCILLATOR_COUNT = 2;

  private readonly left: OscillatorNode;
  private readonly right: OscillatorNode;
  private readonly gain: GainNode;
  private carrier: number;
  private beat: number;
  /** Present only when tracking phase (offline export) — see ToneLayer. */
  readonly trackers: OscillatorPhaseTracker[] | null;
  private started: boolean;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    carrier: number,
    beat: number,
    opts: OscillatorLayerOptions = {},
  ) {
    this.carrier = carrier;
    this.beat = beat;
    this.left = new OscillatorNode(ctx, { type: 'sine', frequency: carrier - beat / 2 });
    this.right = new OscillatorNode(ctx, { type: 'sine', frequency: carrier + beat / 2 });
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.left.connect(merger, 0, 0);
    this.right.connect(merger, 0, 1);
    this.gain = new GainNode(ctx, { gain: 0 });
    merger.connect(this.gain).connect(destination);
    this.trackers = opts.trackPhase
      ? [new OscillatorPhaseTracker(carrier - beat / 2), new OscillatorPhaseTracker(carrier + beat / 2)]
      : null;
    this.started = !opts.trackPhase;
    if (this.started) {
      this.left.start();
      this.right.start();
    }
  }

  /** Start a tracked layer's oscillators after `delays` (left, right); see ToneLayer.start. */
  start(delays: readonly number[] | null): void {
    if (this.started) return;
    this.started = true;
    const now = this.ctx.currentTime;
    [this.left, this.right].forEach((o, i) => {
      const delay = delays?.[i] ?? 0;
      o.start(now + delay);
      this.trackers?.[i].start(now + delay);
    });
  }

  setCarrier(hz: number, timeConstant?: number): void {
    this.carrier = hz;
    this.applyFrequencies(timeConstant);
  }

  setBeat(hz: number, timeConstant?: number): void {
    this.beat = hz;
    this.applyFrequencies(timeConstant);
  }

  setLevel(level: number, timeConstant?: number): void {
    ramp(this.ctx, this.gain.gain, level, timeConstant);
  }

  private applyFrequencies(timeConstant: number = RAMP_TIME_CONSTANT): void {
    const l = this.carrier - this.beat / 2;
    const r = this.carrier + this.beat / 2;
    ramp(this.ctx, this.left.frequency, l, timeConstant);
    ramp(this.ctx, this.right.frequency, r, timeConstant);
    if (this.trackers) {
      const t = this.ctx.currentTime;
      this.trackers[0].setFrequency(t, l, timeConstant);
      this.trackers[1].setFrequency(t, r, timeConstant);
    }
  }

  dispose(): void {
    if (this.started) {
      this.left.stop();
      this.right.stop();
    }
    this.left.disconnect();
    this.right.disconnect();
    this.gain.disconnect();
  }
}
