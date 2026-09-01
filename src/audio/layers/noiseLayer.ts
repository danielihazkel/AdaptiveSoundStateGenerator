import { NOISE_PROCESSOR_NAME } from '../noise-processor';
import { ramp } from '../ramp';
import type { NoiseType } from '../types';

/**
 * Colored-noise layer (PRD §6D) backed by the AudioWorklet processor.
 * The worklet module must already be loaded on the context
 * (AudioEngine calls loadNoiseWorklet during creation).
 */
export class NoiseLayer {
  private readonly node: AudioWorkletNode;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    type: NoiseType,
  ) {
    this.node = new AudioWorkletNode(ctx, NOISE_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.gain = new GainNode(ctx, { gain: 0 });
    this.node.connect(this.gain).connect(destination);
    this.setType(type);
  }

  /**
   * Switch colour; the worklet crossfades equal-power over `fadeSeconds`
   * (default ~100 ms — click-free for a slider tap; programs pass longer).
   */
  setType(type: NoiseType, fadeSeconds?: number): void {
    this.node.port.postMessage({ type, fadeSeconds });
  }

  setLevel(level: number, timeConstant?: number): void {
    ramp(this.ctx, this.gain.gain, level, timeConstant);
  }

  dispose(): void {
    this.node.disconnect();
    this.gain.disconnect();
  }
}
