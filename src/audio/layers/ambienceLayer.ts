import { AMBIENCE_PROCESSOR_NAME } from '../ambience-processor';
import { loadAmbienceBuffer } from '../ambienceAssets';
import { ramp } from '../ramp';
import {
  SAMPLE_AMBIENCE_TYPES,
  type AmbienceType,
  type SampleAmbienceType,
} from '../types';

/** Crossfade when moving between the synthesized and sample sources. */
const SOURCE_SWITCH_TIME_CONSTANT = 0.15; // reads as ~0.5 s

function hasSampleUpgrade(type: AmbienceType): type is SampleAmbienceType {
  return (SAMPLE_AMBIENCE_TYPES as readonly string[]).includes(type);
}

/**
 * Ambience layer (PRD §6E): one output feeding two internal sources — the
 * synthesis worklet, which renders every type and plays immediately, and a
 * looping sample player that takes over (crossfade) only once a recording
 * for the type has been fetched and decoded. No recording shipped, or a
 * failed load, simply means the synthesized version keeps playing: the
 * profile stays valid and applyAll stays idempotent.
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
  /** Pending sample fetch+decode, if any — see whenReady(). */
  private loadPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly ctx: BaseAudioContext,
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

  /**
   * Switch type; the worklet crossfades equal-power over `fadeSeconds`
   * (default ~100 ms — click-free for a slider tap; programs pass longer,
   * and the synth↔recording ramps stretch to match).
   */
  setType(type: AmbienceType, fadeSeconds?: number): void {
    if (type === this.type) return;
    this.type = type;
    this.applyType(type, fadeSeconds);
  }

  setLevel(level: number, timeConstant?: number): void {
    ramp(this.ctx, this.gain.gain, level, timeConstant);
  }

  /**
   * Resolves once any in-flight sample fetch+decode has settled. Offline
   * rendering must await this before startRendering() — the render would
   * otherwise finish before the async load lands. Never rejects: a failed
   * load plays silence, matching realtime behavior.
   */
  whenReady(): Promise<void> {
    return this.loadPromise;
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.stopSample();
    this.node.disconnect();
    this.synthGain.disconnect();
    this.sampleGain.disconnect();
    this.gain.disconnect();
  }

  private applyType(type: AmbienceType, fadeSeconds?: number): void {
    this.loadGeneration += 1;
    // Always start with the synthesized version — the worklet crossfades
    // between its own types internally, so this is instant and click-free.
    // A long program fade stretches the source ramps to the same scale
    // (a setTargetAtTime constant lands in ~3τ).
    const tc =
      fadeSeconds !== undefined && fadeSeconds > 0
        ? Math.max(SOURCE_SWITCH_TIME_CONSTANT, fadeSeconds / 3)
        : SOURCE_SWITCH_TIME_CONSTANT;
    this.stopSample();
    this.node.port.postMessage({ type, fadeSeconds });
    ramp(this.ctx, this.synthGain.gain, 1, tc);
    ramp(this.ctx, this.sampleGain.gain, 0, tc);
    if (hasSampleUpgrade(type)) {
      this.loadPromise = this.startSample(type, this.loadGeneration, tc).catch(() => {
        // Load failures leave the synthesized version playing — never propagate.
      });
    } else {
      this.loadPromise = Promise.resolve();
    }
  }

  /** Swaps in the recording for `type` once loaded; no-op when there is none. */
  private async startSample(
    type: SampleAmbienceType,
    generation: number,
    timeConstant: number = SOURCE_SWITCH_TIME_CONSTANT,
  ): Promise<void> {
    const loop = await loadAmbienceBuffer(this.ctx, type);
    if (generation !== this.loadGeneration) return; // stale — type changed again
    if (!loop) return; // no recording shipped: the synthesized version stays
    this.stopSample();
    const source = new AudioBufferSourceNode(this.ctx, {
      buffer: loop.buffer,
      loop: true,
      loopStart: loop.loopStart,
      loopEnd: loop.loopEnd,
    });
    source.connect(this.sampleGain);
    source.start();
    this.sampleSource = source;
    ramp(this.ctx, this.sampleGain.gain, 1, timeConstant);
    ramp(this.ctx, this.synthGain.gain, 0, timeConstant);
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
