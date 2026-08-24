import type { ProgramModulation } from '../programs/evaluator';
import type { ArcModulation } from '../session/evolution';
import { loadAmbienceWorklet } from './ambience-processor';
import { playChime } from './chime';
import { AmbienceLayer } from './layers/ambienceLayer';
import { BinauralLayer } from './layers/binauralLayer';
import { HarmonyLayer } from './layers/harmonyLayer';
import { NoiseLayer } from './layers/noiseLayer';
import { ToneLayer } from './layers/toneLayer';
import { loadNoiseWorklet } from './noise-processor';
import { PulseModulator } from './pulseModulator';
import { fadeTo, ramp } from './ramp';
import { MAX_PULSE_RATE_HZ } from './states';
import { StereoWidthNode } from './stereoWidth';
import {
  cloneProfile,
  type AmbienceType,
  type NoiseType,
  type RhythmMode,
  type SoundProfile,
} from './types';

const FADE_IN_SECONDS = 1.5; // PRD §13: always fade in, no sudden loud sounds
const FADE_OUT_SECONDS = 1.0;
const PAUSE_FADE_SECONDS = 0.3;
const MONO_SWITCH_DIP_SECONDS = 0.15;
const CHIME_SECONDS = 2.0;

/**
 * Per-layer trim so equal slider values sound roughly equally loud (a sine at
 * 0.5 is far louder than pink noise at 0.5). Together with the master limiter
 * and the UI's 0.85 master-volume cap, this is the MVP substitute for the
 * PRD §13 LUFS loudness ceiling. Tuned by ear.
 */
const TONE_TRIM = 0.5;
const BINAURAL_TRIM = 0.5;
/** Four equal-power-normalized pad voices — start below TONE_TRIM, tuned by ear. */
const HARMONY_TRIM = 0.4;
/** Bass low-shelf peak boost; capped here even when a program scales bass up. */
const BASS_MAX_DB = 6;
const NOISE_TRIM: Record<NoiseType, number> = {
  white: 0.35,
  pink: 0.5,
  brown: 0.8,
  blue: 0.3,
};
const AMBIENCE_TRIM: Record<AmbienceType, number> = {
  rain: 0.5,
  ocean: 0.6,
  wind: 0.55,
  space: 0.7,
  forest: 0.6,
  fireplace: 0.6,
  cafe: 0.6,
};

/** Depth floor for the mono-fallback pulse substitution (see below). */
const MONO_SUBSTITUTE_MIN_DEPTH = 0.35;

/**
 * Owns the AudioContext and the full node graph. Create from a user gesture
 * (click/tap) — browsers refuse to start audio otherwise. One instance is
 * meant to live for the whole app session, reconfigured via applyProfile().
 *
 * Graph:
 *   tone ─┬→ StereoWidthNode ─┐
 *   noise ┘                   ├→ mixBus → PulseModulator → master → lowpass → limiter → monoGate → destination
 *   binaural ─────────────────┘              ambience ──────↗ chime ────────↗
 *
 * Binaural bypasses the width matrix on purpose: narrowing it would collapse
 * the interaural frequency difference into ordinary amplitude beating.
 * Ambience joins at master, after the PulseModulator: the isochronic pulse is
 * a stimulus for tone/noise — chopping rain with it would sound broken — but
 * ambience still rides master (session fades) and sits under the lowpass and
 * limiter (§13). It is stereo-decorrelated at the source, so skipping the
 * width matrix is fine.
 */
export class AudioEngine {
  private playing = false;
  private monoMode = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Session-evolution arc (PRD §12), composed into effective values inside
   * applyAll and never written into the profile: presets, the bandit, and
   * user-edit detection all keep seeing the unmodulated base profile.
   */
  private arcModulation: ArcModulation = { intensity: 1, beatOffsetHz: 0, lowpassScale: 1 };
  /**
   * Timed-program modulation (segment timelines). Same side-channel contract
   * as the arc — composed in applyAll, never written into the profile — but
   * when active it *replaces* the arc composition entirely: a program owns
   * the whole session shape.
   */
  private programModulation: ProgramModulation | null = null;

  /** Notified on every AudioContext state change (interruption handling). */
  onContextStateChange: ((state: AudioContextState) => void) | undefined;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly master: GainNode,
    private readonly lowpass: BiquadFilterNode,
    private readonly bassShelf: BiquadFilterNode,
    private readonly limiter: DynamicsCompressorNode,
    private readonly monoGate: GainNode,
    private readonly width: StereoWidthNode,
    private readonly pulse: PulseModulator,
    private readonly tone: ToneLayer,
    private readonly binaural: BinauralLayer,
    private readonly noise: NoiseLayer,
    private readonly ambience: AmbienceLayer,
    private readonly harmony: HarmonyLayer,
    private profile: SoundProfile,
  ) {
    ctx.onstatechange = () => this.onContextStateChange?.(ctx.state);
  }

  static async create(profile: SoundProfile): Promise<AudioEngine> {
    const ctx = new AudioContext();
    await Promise.all([loadNoiseWorklet(ctx), loadAmbienceWorklet(ctx)]);
    const p = cloneProfile(profile);

    // Output chain, built back to front.
    const monoGate = new GainNode(ctx, {
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    monoGate.connect(ctx.destination);
    // Hard limiter — safety net, not an effect (PRD §13 loudness ceiling).
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -10,
      knee: 0,
      ratio: 20,
      attack: 0.003,
      release: 0.25,
    });
    limiter.connect(monoGate);
    // Bass shelf sits after master (session fades scale it) and before the
    // limiter (the boost stays under the §13 ceiling). Gain 0 dB = inert.
    const bassShelf = new BiquadFilterNode(ctx, {
      type: 'lowshelf',
      frequency: 150,
      gain: 0,
    });
    bassShelf.connect(limiter);
    const lowpass = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: p.lowpassHz,
      Q: 0.0001,
    });
    lowpass.connect(bassShelf);
    const master = new GainNode(ctx, { gain: 0 });
    master.connect(lowpass);

    // Layer bus.
    const mixBus = new GainNode(ctx);
    const pulse = new PulseModulator(
      ctx,
      master,
      p.isochronic.rate,
      p.isochronic.enabled ? p.isochronic.depth : 0,
    );
    mixBus.connect(pulse.input);
    const width = new StereoWidthNode(ctx, mixBus, p.stereoWidth);
    const tone = new ToneLayer(ctx, width.input, p.tone.frequency);
    const noise = new NoiseLayer(ctx, width.input, p.noise.type);
    const binaural = new BinauralLayer(ctx, mixBus, p.binaural.carrier, p.binaural.beat);
    // Post-pulse tap (see graph note above).
    const ambience = new AmbienceLayer(ctx, master, p.ambience.type);
    // Tonal, mono-compatible — joins the width matrix like tone/noise, and
    // deliberately rides the pulse bus: rhythm pulsing the pad is the effect.
    const harmony = new HarmonyLayer(ctx, width.input, p.harmony.rootHz);

    const engine = new AudioEngine(
      ctx, master, lowpass, bassShelf, limiter, monoGate, width, pulse, tone, binaural,
      noise, ambience, harmony, p,
    );
    engine.applyAll();
    return engine;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isMonoMode(): boolean {
    return this.monoMode;
  }

  get contextState(): AudioContextState {
    return this.ctx.state;
  }

  getProfile(): SoundProfile {
    return cloneProfile(this.profile);
  }

  /**
   * Full ramped reconfiguration — used by preset load and state/intensity
   * changes. Pass a larger timeConstant (ADAPT_RAMP_TIME_CONSTANT) for a slow
   * mid-session glide instead of the default quick morph.
   */
  applyProfile(profile: SoundProfile, timeConstant?: number): void {
    this.profile = cloneProfile(profile);
    this.applyAll(timeConstant);
    if (this.playing) {
      ramp(this.ctx, this.master.gain, this.profile.masterVolume, timeConstant);
    }
  }

  /**
   * Session-evolution entry point (PRD §12). Deliberately separate from
   * applyProfile: it never touches master.gain, so it structurally cannot
   * cancel an in-flight session/pause fade, and the base profile stays
   * untouched for presets, records, and user-edit detection.
   */
  setArcModulation(mod: ArcModulation, timeConstant?: number): void {
    this.arcModulation = { ...mod };
    this.applyAll(timeConstant);
  }

  /**
   * Timed-program entry point. Like setArcModulation it never touches
   * master.gain and never writes into the profile. Pass null when no program
   * is active (plain sessions must clear any leftover program state).
   */
  setProgramModulation(mod: ProgramModulation | null, timeConstant?: number): void {
    this.programModulation = mod
      ? { ...mod, rhythm: mod.rhythm ? { ...mod.rhythm } : null }
      : null;
    this.applyAll(timeConstant);
  }

  async start(): Promise<void> {
    clearTimeout(this.stopTimer);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.applyAll();
    fadeTo(this.ctx, this.master.gain, this.profile.masterVolume, FADE_IN_SECONDS);
    this.playing = true;
  }

  /** Early stop: quick fade to silence, then suspend. */
  stop(): void {
    this.endSession(FADE_OUT_SECONDS, false);
  }

  /**
   * End-of-session fade (per-state duration — sleep uses a long fade, PRD §4).
   * Optionally plays the gentle chime once silence is reached.
   */
  endSession(fadeSeconds: number, chime: boolean): void {
    clearTimeout(this.stopTimer);
    fadeTo(this.ctx, this.master.gain, 0, fadeSeconds);
    this.playing = false;
    this.stopTimer = setTimeout(() => {
      if (this.playing) return;
      if (chime) {
        playChime(this.ctx, this.limiter);
        this.stopTimer = setTimeout(() => {
          if (!this.playing) void this.ctx.suspend();
        }, CHIME_SECONDS * 1000);
      } else {
        void this.ctx.suspend();
      }
    }, (fadeSeconds + 0.1) * 1000);
  }

  async pause(): Promise<void> {
    clearTimeout(this.stopTimer);
    fadeTo(this.ctx, this.master.gain, 0, PAUSE_FADE_SECONDS);
    this.playing = false;
    await new Promise((resolve) => setTimeout(resolve, PAUSE_FADE_SECONDS * 1000 + 50));
    if (!this.playing) await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    clearTimeout(this.stopTimer);
    await this.ctx.resume();
    fadeTo(this.ctx, this.master.gain, this.profile.masterVolume, PAUSE_FADE_SECONDS);
    this.playing = true;
  }

  /**
   * Mono/speaker fallback (PRD §7) — a device setting, never stored in the
   * profile. Binaural beats are meaningless in mono, so while mono is on the
   * binaural layer is silenced and substituted with a pulsed tone at the
   * carrier frequency (isochronic at the beat rate) to keep the rhythmic
   * stimulus. Doubles as the single-sided-hearing accessibility mode.
   */
  setMonoMode(on: boolean): void {
    if (this.monoMode === on) return;
    this.monoMode = on;
    if (!this.playing) {
      this.monoGate.channelCount = on ? 1 : 2;
      this.applyAll();
      return;
    }
    // Reconfiguring channel counts can glitch — hide it in a quick dip.
    fadeTo(this.ctx, this.master.gain, 0, MONO_SWITCH_DIP_SECONDS);
    setTimeout(() => {
      this.monoGate.channelCount = on ? 1 : 2;
      this.applyAll();
      if (this.playing) {
        fadeTo(this.ctx, this.master.gain, this.profile.masterVolume, MONO_SWITCH_DIP_SECONDS);
      }
    }, MONO_SWITCH_DIP_SECONDS * 1000 + 30);
  }

  setMasterVolume(volume: number): void {
    this.profile.masterVolume = volume;
    if (this.playing) ramp(this.ctx, this.master.gain, volume);
  }

  setToneEnabled(enabled: boolean): void {
    this.profile.tone.enabled = enabled;
    this.applyAll();
  }

  setToneFrequency(hz: number): void {
    this.profile.tone.frequency = hz;
    this.applyAll();
  }

  setToneLevel(level: number): void {
    this.profile.tone.level = level;
    this.applyAll();
  }

  setBinauralEnabled(enabled: boolean): void {
    this.profile.binaural.enabled = enabled;
    this.applyAll();
  }

  setBinauralCarrier(hz: number): void {
    this.profile.binaural.carrier = hz;
    this.applyAll();
  }

  setBinauralBeat(hz: number): void {
    this.profile.binaural.beat = hz;
    this.applyAll();
  }

  setBinauralLevel(level: number): void {
    this.profile.binaural.level = level;
    this.applyAll();
  }

  setNoiseEnabled(enabled: boolean): void {
    this.profile.noise.enabled = enabled;
    this.applyAll();
  }

  setNoiseType(type: NoiseType): void {
    this.profile.noise.type = type;
    this.applyAll();
  }

  setNoiseLevel(level: number): void {
    this.profile.noise.level = level;
    this.applyAll();
  }

  setIsochronicEnabled(enabled: boolean): void {
    this.profile.isochronic.enabled = enabled;
    this.applyAll();
  }

  setIsochronicRate(hz: number): void {
    this.profile.isochronic.rate = hz;
    this.applyAll();
  }

  setIsochronicDepth(depth: number): void {
    this.profile.isochronic.depth = depth;
    this.applyAll();
  }

  setRhythmMode(mode: RhythmMode): void {
    this.profile.rhythm.mode = mode;
    this.applyAll();
  }

  setRhythmBpm(bpm: number): void {
    this.profile.rhythm.bpm = bpm;
    this.applyAll();
  }

  setRhythmComplexity(complexity: number): void {
    this.profile.rhythm.complexity = complexity;
    this.applyAll();
  }

  setHarmonyEnabled(enabled: boolean): void {
    this.profile.harmony.enabled = enabled;
    this.applyAll();
  }

  setHarmonyLevel(level: number): void {
    this.profile.harmony.level = level;
    this.applyAll();
  }

  setHarmonyRichness(richness: number): void {
    this.profile.harmony.richness = richness;
    this.applyAll();
  }

  setHarmonyMovement(movement: number): void {
    this.profile.harmony.movement = movement;
    this.applyAll();
  }

  setHarmonyRoot(hz: number): void {
    this.profile.harmony.rootHz = hz;
    this.applyAll();
  }

  setBass(bass: number): void {
    this.profile.bass = bass;
    this.applyAll();
  }

  setStereoWidth(w: number): void {
    this.profile.stereoWidth = w;
    this.applyAll();
  }

  setLowpass(hz: number): void {
    this.profile.lowpassHz = hz;
    this.applyAll();
  }

  dispose(): void {
    clearTimeout(this.stopTimer);
    this.ctx.onstatechange = null;
    this.tone.dispose();
    this.binaural.dispose();
    this.noise.dispose();
    this.ambience.dispose();
    this.harmony.dispose();
    this.width.dispose();
    this.pulse.dispose();
    this.master.disconnect();
    this.lowpass.disconnect();
    this.bassShelf.disconnect();
    this.limiter.disconnect();
    this.monoGate.disconnect();
    void this.ctx.close();
  }

  /**
   * Push the whole profile (plus the arc modulation and the mono
   * substitution, both computed here and never written back) to the node
   * graph. Everything ramps, so re-applying unchanged values is free and
   * click-free.
   */
  private applyAll(timeConstant?: number): void {
    const p = this.profile;
    const mod = this.arcModulation;
    const pm = this.programModulation;
    const substitute = this.monoMode && p.binaural.enabled;

    // Arc composition (PRD §12): the beat drifts by an offset, every layer
    // level and the pulse depth scale with the arc intensity, and the lowpass
    // can darken. The states.ts coherence rule survives modulation: a pulse
    // rate that tracked the base beat tracks the modulated beat. An active
    // program replaces the arc: its segment intensity/lowpass take over, its
    // texture scalers multiply per-layer levels, and the beat stays unshifted
    // (programs shape rhythm through BPM, not beat offsets).
    const beat = Math.max(0.5, p.binaural.beat + (pm ? 0 : mod.beatOffsetHz));
    const trackingBeat =
      p.isochronic.rate === Math.min(p.binaural.beat, MAX_PULSE_RATE_HZ);
    const arcGain = pm ? pm.intensity : mod.intensity;
    const lowpassHz = Math.max(
      200,
      p.lowpassHz * (pm ? pm.lowpassScale : mod.lowpassScale),
    );
    const noiseScale = pm?.noiseScale ?? 1;
    const ambienceScale = pm?.ambienceScale ?? 1;
    const toneScale = pm?.toneScale ?? 1;
    const harmonyScale = pm?.harmonyScale ?? 1;
    const bassScale = pm?.bassScale ?? 1;
    // A program segment may override tone warmth; it softens the pad too.
    const warmth = pm && pm.warmth !== null ? pm.warmth : p.tone.warmth;

    const toneEnabled = substitute ? true : p.tone.enabled;
    const toneFrequency = substitute ? p.binaural.carrier : p.tone.frequency;
    const toneLevel = (substitute ? p.binaural.level : p.tone.level) * arcGain * toneScale;
    const isoEnabled = substitute ? true : p.isochronic.enabled;
    const isoRate = substitute
      ? beat
      : trackingBeat
        ? Math.min(beat, MAX_PULSE_RATE_HZ)
        : p.isochronic.rate;
    const isoDepth =
      (substitute
        ? Math.max(p.isochronic.enabled ? p.isochronic.depth : 0, MONO_SUBSTITUTE_MIN_DEPTH)
        : p.isochronic.depth) * arcGain;

    this.tone.setFrequency(toneFrequency, timeConstant);
    this.tone.setCharacter(warmth, timeConstant);
    this.tone.setLevel(toneEnabled ? toneLevel * TONE_TRIM : 0, timeConstant);
    this.binaural.setCarrier(p.binaural.carrier, timeConstant);
    this.binaural.setBeat(beat, timeConstant);
    this.binaural.setLevel(
      p.binaural.enabled && !substitute ? p.binaural.level * arcGain * BINAURAL_TRIM : 0,
      timeConstant,
    );
    this.noise.setType(p.noise.type);
    this.noise.setLevel(
      p.noise.enabled ? p.noise.level * arcGain * noiseScale * NOISE_TRIM[p.noise.type] : 0,
      timeConstant,
    );
    this.ambience.setType(p.ambience.type);
    this.ambience.setLevel(
      p.ambience.enabled
        ? p.ambience.level * arcGain * ambienceScale * AMBIENCE_TRIM[p.ambience.type]
        : 0,
      timeConstant,
    );
    // Mono substitution stays on the simple path: its pulsed-tone stand-in
    // for binaural must track the beat rate, not a musical BPM grid.
    const patternRhythm = substitute ? null : (pm?.rhythm ?? null);
    const patternMode =
      !substitute && (patternRhythm !== null || p.rhythm.mode === 'pattern');
    if (patternMode) {
      this.pulse.setMode('pattern', timeConstant);
      this.pulse.setPattern(
        patternRhythm?.bpm ?? p.rhythm.bpm,
        patternRhythm?.complexity ?? p.rhythm.complexity,
        isoEnabled ? isoDepth : 0,
        timeConstant,
      );
    } else {
      this.pulse.setMode('simple', timeConstant);
      this.pulse.setRate(isoRate, timeConstant);
      this.pulse.setDepth(isoEnabled ? isoDepth : 0, timeConstant);
    }
    this.harmony.setRoot(p.harmony.rootHz, timeConstant);
    this.harmony.setRichness(p.harmony.richness, timeConstant);
    this.harmony.setMovement(p.harmony.movement, timeConstant);
    this.harmony.setSoftness(warmth, timeConstant);
    this.harmony.setLevel(
      p.harmony.enabled ? p.harmony.level * arcGain * harmonyScale * HARMONY_TRIM : 0,
      timeConstant,
    );
    ramp(
      this.ctx,
      this.bassShelf.gain,
      BASS_MAX_DB * Math.min(1, p.bass * bassScale),
      timeConstant,
    );
    this.width.setWidth(p.stereoWidth, timeConstant);
    ramp(this.ctx, this.lowpass.frequency, lowpassHz, timeConstant);
  }
}
