import { ramp } from '../ramp';

/**
 * Binaural beat pair (PRD §6B): left = carrier - beat/2, right = carrier + beat/2.
 * Oscillators are hard-routed to separate channels; beat changes glide via
 * ramped frequency updates rather than switching abruptly.
 */
export class BinauralLayer {
  private readonly left: OscillatorNode;
  private readonly right: OscillatorNode;
  private readonly gain: GainNode;
  private carrier: number;
  private beat: number;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    carrier: number,
    beat: number,
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
    this.left.start();
    this.right.start();
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

  private applyFrequencies(timeConstant?: number): void {
    ramp(this.ctx, this.left.frequency, this.carrier - this.beat / 2, timeConstant);
    ramp(this.ctx, this.right.frequency, this.carrier + this.beat / 2, timeConstant);
  }

  dispose(): void {
    this.left.stop();
    this.right.stop();
    this.left.disconnect();
    this.right.disconnect();
    this.gain.disconnect();
  }
}
