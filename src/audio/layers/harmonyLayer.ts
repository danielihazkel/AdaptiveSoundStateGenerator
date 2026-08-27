import { ramp } from '../ramp';

/**
 * Harmonic pad: stacked intervals over a root with slow internal movement —
 * the "harmonic richness" layer for emotionally progressive soundscapes.
 *
 * Four sine voices: root, fifth (+7 st), octave, major third above the octave
 * (+16 st). `richness` fades the upper voices in continuously (staggered
 * smoothsteps, equal-power normalized so loudness is richness-invariant —
 * same contract as ToneLayer.setCharacter). `movement` drives three
 * free-running LFOs (0.013/0.021/0.034 Hz, incommensurate so the pattern
 * never repeats) that gently undulate the upper-voice gains and detune —
 * perceptible "harmonic movement" without any discrete changes.
 *
 * Per-voice chain: osc → voiceGain (richness amp, ramped) → wobbleGain
 * (base 1, LFO-modulated) → shared lowpass → level gain → destination.
 * The two-gain series is deliberate: LFO depth is capped at 0.35, so the
 * wobbled gain stays in [0.65, 1.35] and can never flip phase, no matter
 * where a concurrent ramp on the richness gain sits. ramp()'s
 * cancelScheduledValues only clears scheduled automation — audio-rate LFO
 * inputs keep summing, so ramps and LFOs coexist safely.
 */

const VOICE_RATIOS = {
  root: 1,
  fifth: 2 ** (7 / 12),
  octave: 2,
  third: 2 ** (16 / 12),
} as const;

const VOICE_DETUNE_CENTS = { root: 0, fifth: 2, octave: -2, third: 3 } as const;

/** Peak per-voice amplitudes at richness 1, before normalization. */
const FIFTH_AMP = 0.7;
const OCTAVE_AMP = 0.55;
const THIRD_AMP = 0.4;

const LFO_RATES_HZ = [0.013, 0.021, 0.034] as const;
const GAIN_WOBBLE_DEPTH_A = 0.3; // × movement, on the fifth
const GAIN_WOBBLE_DEPTH_B = 0.35; // × movement, on octave + third
const DETUNE_WOBBLE_CENTS = 4; // × movement, on fifth + third

/** The pad's own lowpass: open at softness 0, closing toward the root at 1. */
const OPEN_CUTOFF_HZ = 4000;
const MIN_CUTOFF_HZ = 500;

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export interface HarmonyVoiceAmps {
  root: number;
  fifth: number;
  octave: number;
  third: number;
}

/**
 * Per-voice amplitudes at a given richness — pure, exported for tests.
 * Continuous in richness (no discrete voicing switches) and equal-power
 * normalized, so a slow richness ramp thickens the pad without a loudness or
 * character jump.
 */
export function harmonyVoiceAmps(richness: number): HarmonyVoiceAmps {
  const r = Math.min(1, Math.max(0, richness));
  const fade = (from: number, to: number) => smoothstep((r - from) / (to - from));
  const fifth = FIFTH_AMP * fade(0, 0.35);
  const octave = OCTAVE_AMP * fade(0.25, 0.65);
  const third = THIRD_AMP * fade(0.5, 1);
  const norm = 1 / Math.sqrt(1 + fifth * fifth + octave * octave + third * third);
  return { root: norm, fifth: fifth * norm, octave: octave * norm, third: third * norm };
}

type VoiceName = keyof HarmonyVoiceAmps;
const VOICE_NAMES: readonly VoiceName[] = ['root', 'fifth', 'octave', 'third'];

interface Voice {
  osc: OscillatorNode;
  voiceGain: GainNode; // richness amplitude, ramped
  wobbleGain: GainNode; // base 1, LFO sums on top
}

export class HarmonyLayer {
  private readonly voices: Record<VoiceName, Voice>;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly lfos: OscillatorNode[];
  private readonly gainWobbleA: GainNode; // LFO1 depth → fifth
  private readonly gainWobbleB: GainNode; // LFO2 depth → octave + third
  private readonly detuneWobble: GainNode; // LFO3 depth → fifth + third detune
  private rootHz: number;
  private softness = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    rootHz: number,
  ) {
    this.rootHz = rootHz;
    this.filter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: OPEN_CUTOFF_HZ,
      Q: 0.0001,
    });
    this.gain = new GainNode(ctx, { gain: 0 });
    this.filter.connect(this.gain).connect(destination);

    const amps = harmonyVoiceAmps(0);
    this.voices = Object.fromEntries(
      VOICE_NAMES.map((name) => {
        const osc = new OscillatorNode(ctx, {
          type: 'sine',
          frequency: rootHz * VOICE_RATIOS[name],
          detune: VOICE_DETUNE_CENTS[name],
        });
        const voiceGain = new GainNode(ctx, { gain: amps[name] });
        const wobbleGain = new GainNode(ctx, { gain: 1 });
        osc.connect(voiceGain).connect(wobbleGain).connect(this.filter);
        osc.start();
        return [name, { osc, voiceGain, wobbleGain }];
      }),
    ) as Record<VoiceName, Voice>;

    this.lfos = LFO_RATES_HZ.map(
      (rate) => new OscillatorNode(ctx, { type: 'sine', frequency: rate }),
    );
    this.gainWobbleA = new GainNode(ctx, { gain: 0 });
    this.gainWobbleB = new GainNode(ctx, { gain: 0 });
    this.detuneWobble = new GainNode(ctx, { gain: 0 });
    this.lfos[0].connect(this.gainWobbleA);
    this.lfos[1].connect(this.gainWobbleB);
    this.lfos[2].connect(this.detuneWobble);
    this.gainWobbleA.connect(this.voices.fifth.wobbleGain.gain);
    this.gainWobbleB.connect(this.voices.octave.wobbleGain.gain);
    this.gainWobbleB.connect(this.voices.third.wobbleGain.gain);
    this.detuneWobble.connect(this.voices.fifth.osc.detune);
    this.detuneWobble.connect(this.voices.third.osc.detune);
    for (const lfo of this.lfos) lfo.start();
  }

  setRoot(hz: number, timeConstant?: number): void {
    this.rootHz = hz;
    for (const name of VOICE_NAMES) {
      ramp(this.ctx, this.voices[name].osc.frequency, hz * VOICE_RATIOS[name], timeConstant);
    }
    this.applyCutoff(timeConstant);
  }

  setRichness(richness: number, timeConstant?: number): void {
    const amps = harmonyVoiceAmps(richness);
    for (const name of VOICE_NAMES) {
      ramp(this.ctx, this.voices[name].voiceGain.gain, amps[name], timeConstant);
    }
  }

  /** 0 = static pad; 1 = full slow undulation of upper voices and detune. */
  setMovement(movement: number, timeConstant?: number): void {
    const m = Math.min(1, Math.max(0, movement));
    ramp(this.ctx, this.gainWobbleA.gain, GAIN_WOBBLE_DEPTH_A * m, timeConstant);
    ramp(this.ctx, this.gainWobbleB.gain, GAIN_WOBBLE_DEPTH_B * m, timeConstant);
    ramp(this.ctx, this.detuneWobble.gain, DETUNE_WOBBLE_CENTS * m, timeConstant);
  }

  /** Driven by the engine's effective warmth — warmth darkens the pad too. */
  setSoftness(softness: number, timeConstant?: number): void {
    this.softness = Math.min(1, Math.max(0, softness));
    this.applyCutoff(timeConstant);
  }

  setLevel(level: number, timeConstant?: number): void {
    ramp(this.ctx, this.gain.gain, level, timeConstant);
  }

  /** Log-interpolated: open at softness 0, closing toward the root at 1. */
  private applyCutoff(timeConstant?: number): void {
    const closed = Math.max(2.5 * this.rootHz, MIN_CUTOFF_HZ);
    const cutoff = Math.exp(
      Math.log(OPEN_CUTOFF_HZ) +
        (Math.log(closed) - Math.log(OPEN_CUTOFF_HZ)) * this.softness,
    );
    ramp(this.ctx, this.filter.frequency, cutoff, timeConstant);
  }

  dispose(): void {
    for (const name of VOICE_NAMES) {
      const v = this.voices[name];
      v.osc.stop();
      v.osc.disconnect();
      v.voiceGain.disconnect();
      v.wobbleGain.disconnect();
    }
    for (const lfo of this.lfos) {
      lfo.stop();
      lfo.disconnect();
    }
    this.gainWobbleA.disconnect();
    this.gainWobbleB.disconnect();
    this.detuneWobble.disconnect();
    this.filter.disconnect();
    this.gain.disconnect();
  }
}
