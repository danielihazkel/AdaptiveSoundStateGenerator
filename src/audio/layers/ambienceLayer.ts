import { AMBIENCE_PROCESSOR_NAME } from '../ambience-processor';
import { loadAmbienceBuffer } from '../ambienceAssets';
import { ramp } from '../ramp';
import {
  SYNTH_AMBIENCE_TYPES,
  type AmbienceType,
  type SampleAmbienceType,
  type SynthAmbienceType,
} from '../types';

/** Crossfade when moving between the synthesized and sample sources. */
const SOURCE_SWITCH_TIME_CONSTANT = 0.15; // reads as ~0.5 s

function isSynth(type: AmbienceType): type is SynthAmbienceType {
  return (SYNTH_AMBIENCE_TYPES as readonly string[]).includes(type);
}

/**
 * Ambience layer (PRD §6E): one output feeding two internal sources — the
 * synthesized-weather worklet (always available) and a looping sample player
 * (active only when an asset for the type is shipped). Selecting a sample
 * type with no asset plays silence rather than failing: the profile stays
 * valid and applyAll stays idempotent.
 *
 * The worklet module must already be loaded on the context (AudioEngine calls
 * loadAmbienceWorklet during creation).
 */
export class AmbienceLayer {
  private readonly node: AudioWorkletNode;
  private readonly synthGain: GainNode;
  private readonly sampleGain: GainNode;
  private readonly gain: GainNode;
  private type: AmbienceType;
  private sampleSource: AudioBufferSourceNode | undefined;
  /** Drops sample loads that finish after the type has changed again. */
  private loadGeneration = 0;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    type: AmbienceType,
  ) {
    this.node = new AudioWorkletNode(ctx, AMBIENCE_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.synthGain = new GainNode(ctx, { gain: 0 });
    this.sampleGain = new GainNode(ctx, { gain: 0 });
    this.gain = new GainNode(ctx, { gain: 0 });
    this.node.connect(this.synthGain).connect(this.gain);
    this.sampleGain.connect(this.gain);
    this.gain.connect(destination);
    this.type = type;
    this.applyType(type);
  }

  setType(type: AmbienceType): void {
    if (type === this.type) return;
    this.type = type;
    this.applyType(type);
  }

  setLevel(level: number, timeConstant?: number): void {
    ramp(this.ctx, this.gain.gain, level, timeConstant);
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.stopSample();
    this.node.disconnect();
    this.synthGain.disconnect();
    this.sampleGain.disconnect();
    this.gain.disconnect();
  }

  private applyType(type: AmbienceType): void {
    this.loadGeneration += 1;
    if (isSynth(type)) {
      this.stopSample();
      // The worklet crossfades between its own types internally.
      this.node.port.postMessage({ type });
      ramp(this.ctx, this.synthGain.gain, 1, SOURCE_SWITCH_TIME_CONSTANT);
      ramp(this.ctx, this.sampleGain.gain, 0, SOURCE_SWITCH_TIME_CONSTANT);
    } else {
      ramp(this.ctx, this.synthGain.gain, 0, SOURCE_SWITCH_TIME_CONSTANT);
      void this.startSample(type, this.loadGeneration);
    }
  }

  private async startSample(type: SampleAmbienceType, generation: number): Promise<void> {
    const loop = await loadAmbienceBuffer(this.ctx, type);
    if (generation !== this.loadGeneration) return; // stale — type changed again
    this.stopSample();
    if (!loop) {
      // Asset missing/undecodable: silence, by design.
      ramp(this.ctx, this.sampleGain.gain, 0, SOURCE_SWITCH_TIME_CONSTANT);
      return;
    }
    const source = new AudioBufferSourceNode(this.ctx, {
      buffer: loop.buffer,
      loop: true,
      loopStart: loop.loopStart,
      loopEnd: loop.loopEnd,
    });
    source.connect(this.sampleGain);
    source.start();
    this.sampleSource = source;
    ramp(this.ctx, this.sampleGain.gain, 1, SOURCE_SWITCH_TIME_CONSTANT);
  }

  private stopSample(): void {
    if (!this.sampleSource) return;
    try {
      this.sampleSource.stop();
    } catch {
      // Already stopped — fine.
    }
    this.sampleSource.disconnect();
    this.sampleSource = undefined;
  }
}
