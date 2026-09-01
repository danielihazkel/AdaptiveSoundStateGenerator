import type { ProgramModulation } from '../programs/evaluator';
import type { ArcModulation } from '../session/evolution';
import { loadAmbienceWorklet } from './ambience-processor';
import type { BreathPattern } from './breathing';
import { playChime } from './chime';
import type { OscillatorPhaseTracker } from '../export/phaseTracker';
import { AmbienceLayer } from './layers/ambienceLayer';
import { BinauralLayer } from './layers/binauralLayer';
import { HarmonyLayer } from './layers/harmonyLayer';
import { NoiseLayer } from './layers/noiseLayer';
import { ToneLayer } from './layers/toneLayer';
import { loadNoiseWorklet } from './noise-processor';
import { PulseModulator, type PulseHandover } from './pulseModulator';
import { fadeTo, ramp } from './ramp';
import { ReverbUnit } from './reverb';
import { StereoWidthNode } from './stereoWidth';
import { cloneProfile, type NoiseType, type RhythmMode, type SoundProfile } from './types';

import { composeEffectiveParams, type EffectiveParams } from './compose';
import {
  ALARM_REPEAT_SECONDS,
  CHIME_SECONDS,
  FADE_IN_SECONDS,
  FADE_OUT_SECONDS,
  MONO_SWITCH_DIP_SECONDS,
  PAUSE_FADE_SECONDS,
} from './mixPolicy';

export { ALARM_REPEAT_SECONDS } from './mixPolicy';

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
  /** Pending channel-count flip from setMonoMode — cleared on dispose. */
  private monoTimer: ReturnType<typeof setTimeout> | undefined;
  private alarmTimer: ReturnType<typeof setInterval> | undefined;
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
  /** Guided-breathing side channel (never part of the profile). */
  private breath: BreathPattern | null = null;
  private breathAnchor = 0;

  /** Listeners for AudioContext state changes (interruption handling). */
  private readonly contextStateListeners = new Set<(state: AudioContextState) => void>();

  private constructor(
    private readonly ctx: BaseAudioContext,
    /** True when rendering to file on an OfflineAudioContext — see createOffline. */
    private readonly offline: boolean,
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
    private readonly ambience2: AmbienceLayer,
    private readonly harmony: HarmonyLayer,
    private readonly preMaster: GainNode,
    private readonly reverb: ReverbUnit,
    private profile: SoundProfile,
  ) {
    // Offline contexts flip suspended/running at every render checkpoint —
    // that is driver mechanics, not an interruption, so don't surface it.
    if (!offline) {
      ctx.onstatechange = () => {
        for (const listener of this.contextStateListeners) listener(ctx.state);
      };
    }
  }

  /**
   * Subscribe to AudioContext state changes — how a session or lab run tells
   * an interruption (phone call, another app grabbing the output) from its own
   * pause. Any number of subscribers; returns an unsubscribe.
   */
  subscribeContextState(listener: (state: AudioContextState) => void): () => void {
    this.contextStateListeners.add(listener);
    return () => {
      this.contextStateListeners.delete(listener);
    };
  }

  static async create(profile: SoundProfile): Promise<AudioEngine> {
    return AudioEngine.build(new AudioContext(), profile, false);
  }

  /**
   * Offline-render twin of create(): the identical worklets and node graph on
   * a caller-owned OfflineAudioContext. No user gesture needed. The realtime
   * lifecycle (start/stop/pause/endSession/setMonoMode) must not be used on
   * an offline engine — it leans on wall-clock timers and resume/suspend;
   * use the *Offline methods below, which schedule against ctx time instead.
   */
  static async createOffline(
    profile: SoundProfile,
    ctx: OfflineAudioContext,
  ): Promise<AudioEngine> {
    return AudioEngine.build(ctx, profile, true);
  }

  private static async build(
    ctx: BaseAudioContext,
    profile: SoundProfile,
    offline: boolean,
  ): Promise<AudioEngine> {
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
    // Pulsed mix (tone/noise/binaural/harmony) lands here, pre-master: the
    // reverb send taps it so the wet signal rides master fades, lowpass,
    // bass shelf, limiter and mono gate — while ambience (already diffuse)
    // and the chime stay dry.
    const preMaster = new GainNode(ctx);
    preMaster.connect(master);
    const reverb = new ReverbUnit(ctx, preMaster, master);

    // Layer bus.
    const mixBus = new GainNode(ctx);
    const pulse = new PulseModulator(
      ctx,
      preMaster,
      p.isochronic.rate,
      p.isochronic.enabled ? p.isochronic.depth : 0,
      offline,
    );
    mixBus.connect(pulse.input);
    const width = new StereoWidthNode(ctx, mixBus, p.stereoWidth);
    // Offline engines record oscillator phase and defer start() so chunked
    // exports can seam without a phase jump (export/phaseTracker.ts).
    const tone = new ToneLayer(ctx, width.input, p.tone.frequency, { trackPhase: offline });
    const noise = new NoiseLayer(ctx, width.input, p.noise.type);
    const binaural = new BinauralLayer(ctx, mixBus, p.binaural.carrier, p.binaural.beat, {
      trackPhase: offline,
    });
    // Post-pulse tap (see graph note above). Two independent beds: each
    // worklet instance keeps its own generator state, so rain over fireplace
    // is two uncorrelated textures, not one doubled.
    const ambience = new AmbienceLayer(ctx, master, p.ambience.type);
    const ambience2 = new AmbienceLayer(ctx, master, p.ambience2.type);
    // Tonal, mono-compatible — joins the width matrix like tone/noise, and
    // deliberately rides the pulse bus: rhythm pulsing the pad is the effect.
    const harmony = new HarmonyLayer(ctx, width.input, p.harmony.rootHz);

    const engine = new AudioEngine(
      ctx, offline, master, lowpass, bassShelf, limiter, monoGate, width, pulse, tone,
      binaural, noise, ambience, ambience2, harmony, preMaster, reverb, p,
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

  /** The realtime context, or null offline (no resume/suspend/close there). */
  private get realtime(): AudioContext | null {
    return this.offline ? null : (this.ctx as AudioContext);
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

  /**
   * Guided-breathing entry point: the mix swells with the pattern (see
   * PulseModulator breath mode). Like the arc/program channels it never
   * touches the profile. `anchorCtxTime` is the ctx time of cycle 0 —
   * defaults to now on the first call and is kept across pattern changes so
   * the on-screen pacer (driven by session elapsed time) stays in step.
   * Pass null to return the pulse to the profile's rhythm.
   */
  setBreathPattern(
    pattern: BreathPattern | null,
    anchorCtxTime?: number,
    timeConstant?: number,
  ): void {
    if (pattern && (anchorCtxTime !== undefined || !this.breath)) {
      this.breathAnchor = anchorCtxTime ?? this.ctx.currentTime;
    }
    this.breath = pattern;
    this.applyAll(timeConstant);
  }

  async start(): Promise<void> {
    clearTimeout(this.stopTimer);
    if (this.ctx.state !== 'running') await this.realtime?.resume();
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
          if (!this.playing) void this.realtime?.suspend();
        }, CHIME_SECONDS * 1000);
      } else {
        void this.realtime?.suspend();
      }
    }, (fadeSeconds + 0.1) * 1000);
  }

  /**
   * Wake-up alarm (realtime only): once the end fade has landed, repeat the
   * chime until stopAlarm(). The context stays running; the master gain is
   * already at 0, and the chime feeds the limiter directly.
   */
  startAlarm(): void {
    clearTimeout(this.stopTimer);
    clearInterval(this.alarmTimer);
    this.playing = false;
    const ring = () => {
      if (this.ctx.state !== 'running') void this.realtime?.resume();
      playChime(this.ctx, this.limiter);
    };
    ring();
    this.alarmTimer = setInterval(ring, ALARM_REPEAT_SECONDS * 1000);
  }

  /** Silence the alarm. Suspends unless the session is resuming (snooze). */
  stopAlarm(opts: { suspend?: boolean } = {}): void {
    if (this.alarmTimer === undefined) return;
    clearInterval(this.alarmTimer);
    this.alarmTimer = undefined;
    if (opts.suspend !== false && !this.playing) {
      this.stopTimer = setTimeout(() => {
        if (!this.playing) void this.realtime?.suspend();
      }, CHIME_SECONDS * 1000);
    }
  }

  async pause(): Promise<void> {
    clearTimeout(this.stopTimer);
    fadeTo(this.ctx, this.master.gain, 0, PAUSE_FADE_SECONDS);
    this.playing = false;
    await new Promise((resolve) => setTimeout(resolve, PAUSE_FADE_SECONDS * 1000 + 50));
    if (!this.playing) await this.realtime?.suspend();
  }

  async resume(): Promise<void> {
    clearTimeout(this.stopTimer);
    await this.realtime?.resume();
    fadeTo(this.ctx, this.master.gain, this.profile.masterVolume, PAUSE_FADE_SECONDS);
    this.playing = true;
  }

  // ── Offline-render lifecycle ─────────────────────────────────────────────
  // These schedule against ctx time only (no timers, no resume/suspend), so
  // the offline driver calls them at t=0 or inside frozen suspend
  // checkpoints, where ctx.currentTime is the checkpoint time.

  /**
   * Offline t=0. The first render chunk gets the standard session fade-in;
   * later chunks pick up mid-session and jump straight to `gainFraction` of
   * master volume (1 = playing normally, <1 = inside the end fade).
   */
  beginOffline(
    opts: { fadeIn?: boolean; gainFraction?: number; oscillatorDelays?: readonly number[] | null } = {},
  ): void {
    // Tracked oscillators are stopped until now; every offline start passes
    // through here, so a chunk can never render silent tone/binaural layers.
    this.tone.start(opts.oscillatorDelays?.slice(0, ToneLayer.OSCILLATOR_COUNT) ?? null);
    this.binaural.start(opts.oscillatorDelays?.slice(ToneLayer.OSCILLATOR_COUNT) ?? null);
    this.playing = true;
    const target = this.profile.masterVolume * (opts.gainFraction ?? 1);
    if (opts.fadeIn === false) {
      this.master.gain.setValueAtTime(target, this.ctx.currentTime);
    } else {
      fadeTo(this.ctx, this.master.gain, target, FADE_IN_SECONDS);
    }
  }

  /** Offline chunk handover — see PulseModulator.exportHandover. */
  /**
   * Phase trackers of the tone and binaural oscillators (offline engines
   * only; empty otherwise), in the order beginOffline's delays apply to.
   */
  oscillatorPhaseTrackers(): OscillatorPhaseTracker[] {
    return [...(this.tone.trackers ?? []), ...(this.binaural.trackers ?? [])];
  }

  exportPulseHandover(fromCtxTime: number, ctxToAbs: number): PulseHandover {
    return this.pulse.exportHandover(fromCtxTime, ctxToAbs);
  }

  /** Offline chunk handover — call after the origin modulation is applied. */
  importPulseHandover(handover: PulseHandover, absToCtx: number): void {
    this.pulse.importHandover(handover, absToCtx);
  }

  /** Offline end fade — call at the fade's start checkpoint. */
  scheduleOfflineEndFade(fadeSeconds: number): void {
    this.playing = false;
    fadeTo(this.ctx, this.master.gain, 0, fadeSeconds);
  }

  /** Offline chime — call at the checkpoint where silence has landed. */
  playOfflineChime(): void {
    playChime(this.ctx, this.limiter);
  }

  /**
   * Mid-session cue (a program phase boundary). Same chime, into the
   * limiter — it rides over the mix at a fixed, modest level.
   */
  playCue(): void {
    playChime(this.ctx, this.limiter);
  }

  /** Push pattern-mode pulses forward past the next offline checkpoint. */
  schedulePulsesUntil(time: number): void {
    this.pulse.scheduleAheadUntil(time);
  }

  /** Pending async ambience sample load — await before startRendering(). */
  whenAmbienceReady(): Promise<void> {
    return Promise.all([this.ambience.whenReady(), this.ambience2.whenReady()]).then(() => undefined);
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
    clearTimeout(this.monoTimer);
    if (!this.playing) {
      this.monoGate.channelCount = on ? 1 : 2;
      this.applyAll();
      return;
    }
    // Reconfiguring channel counts can glitch — hide it in a quick dip.
    fadeTo(this.ctx, this.master.gain, 0, MONO_SWITCH_DIP_SECONDS);
    this.monoTimer = setTimeout(() => {
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

  /** Mutate one profile field and re-apply everything (ramped, click-free). */
  private patchProfile(patch: (p: SoundProfile) => void): void {
    patch(this.profile);
    this.applyAll();
  }

  setToneEnabled(enabled: boolean): void {
    this.patchProfile((p) => {
      p.tone.enabled = enabled;
    });
  }

  setToneFrequency(hz: number): void {
    this.patchProfile((p) => {
      p.tone.frequency = hz;
    });
  }

  setToneLevel(level: number): void {
    this.patchProfile((p) => {
      p.tone.level = level;
    });
  }

  setBinauralEnabled(enabled: boolean): void {
    this.patchProfile((p) => {
      p.binaural.enabled = enabled;
    });
  }

  setBinauralCarrier(hz: number): void {
    this.patchProfile((p) => {
      p.binaural.carrier = hz;
    });
  }

  setBinauralBeat(hz: number): void {
    this.patchProfile((p) => {
      p.binaural.beat = hz;
    });
  }

  setBinauralLevel(level: number): void {
    this.patchProfile((p) => {
      p.binaural.level = level;
    });
  }

  setNoiseEnabled(enabled: boolean): void {
    this.patchProfile((p) => {
      p.noise.enabled = enabled;
    });
  }

  setNoiseType(type: NoiseType): void {
    this.patchProfile((p) => {
      p.noise.type = type;
    });
  }

  setNoiseLevel(level: number): void {
    this.patchProfile((p) => {
      p.noise.level = level;
    });
  }

  setIsochronicEnabled(enabled: boolean): void {
    this.patchProfile((p) => {
      p.isochronic.enabled = enabled;
    });
  }

  setIsochronicRate(hz: number): void {
    this.patchProfile((p) => {
      p.isochronic.rate = hz;
    });
  }

  setIsochronicDepth(depth: number): void {
    this.patchProfile((p) => {
      p.isochronic.depth = depth;
    });
  }

  setRhythmMode(mode: RhythmMode): void {
    this.patchProfile((p) => {
      p.rhythm.mode = mode;
    });
  }

  setRhythmBpm(bpm: number): void {
    this.patchProfile((p) => {
      p.rhythm.bpm = bpm;
    });
  }

  setRhythmComplexity(complexity: number): void {
    this.patchProfile((p) => {
      p.rhythm.complexity = complexity;
    });
  }

  setHarmonyEnabled(enabled: boolean): void {
    this.patchProfile((p) => {
      p.harmony.enabled = enabled;
    });
  }

  setHarmonyLevel(level: number): void {
    this.patchProfile((p) => {
      p.harmony.level = level;
    });
  }

  setHarmonyRichness(richness: number): void {
    this.patchProfile((p) => {
      p.harmony.richness = richness;
    });
  }

  setHarmonyMovement(movement: number): void {
    this.patchProfile((p) => {
      p.harmony.movement = movement;
    });
  }

  setHarmonyRoot(hz: number): void {
    this.patchProfile((p) => {
      p.harmony.rootHz = hz;
    });
  }

  setBass(bass: number): void {
    this.patchProfile((p) => {
      p.bass = bass;
    });
  }

  setSpaceLevel(level: number): void {
    this.patchProfile((p) => {
      p.space.level = level;
    });
  }

  setSpaceSize(size: number): void {
    this.patchProfile((p) => {
      p.space.size = size;
    });
  }

  setStereoWidth(w: number): void {
    this.patchProfile((p) => {
      p.stereoWidth = w;
    });
  }

  setLowpass(hz: number): void {
    this.patchProfile((p) => {
      p.lowpassHz = hz;
    });
  }

  dispose(): void {
    clearTimeout(this.stopTimer);
    clearTimeout(this.monoTimer);
    clearInterval(this.alarmTimer);
    this.ctx.onstatechange = null;
    this.contextStateListeners.clear();
    this.tone.dispose();
    this.binaural.dispose();
    this.noise.dispose();
    this.ambience.dispose();
    this.ambience2.dispose();
    this.harmony.dispose();
    this.width.dispose();
    this.pulse.dispose();
    this.reverb.dispose();
    this.preMaster.disconnect();
    this.master.disconnect();
    this.lowpass.disconnect();
    this.bassShelf.disconnect();
    this.limiter.disconnect();
    this.monoGate.disconnect();
    void this.realtime?.close(); // OfflineAudioContext has no close()
  }

  /**
   * Push the whole profile (plus the arc/program/breath side channels and the
   * mono substitution, all composed in compose.ts and never written back) to
   * the node graph. Everything ramps, so re-applying unchanged values is free
   * and click-free.
   */
  private applyAll(timeConstant?: number): void {
    this.applyEffective(
      composeEffectiveParams({
        profile: this.profile,
        arc: this.arcModulation,
        program: this.programModulation,
        breath: this.breath,
        monoMode: this.monoMode,
      }),
      timeConstant,
    );
  }

  /** One ramped node write per composed value, in a fixed order. */
  private applyEffective(e: EffectiveParams, timeConstant?: number): void {
    this.tone.setFrequency(e.tone.frequency, timeConstant);
    this.tone.setCharacter(e.tone.warmth, timeConstant);
    this.tone.setLevel(e.tone.level, timeConstant);
    this.binaural.setCarrier(e.binaural.carrier, timeConstant);
    this.binaural.setBeat(e.binaural.beat, timeConstant);
    this.binaural.setLevel(e.binaural.level, timeConstant);
    this.noise.setType(e.noise.type, e.noise.fadeSec);
    this.noise.setLevel(e.noise.level, timeConstant);
    this.ambience.setType(e.ambience.type, e.ambience.fadeSec);
    this.ambience.setLevel(e.ambience.level, timeConstant);
    this.ambience2.setType(e.ambience2.type, e.ambience2.fadeSec);
    this.ambience2.setLevel(e.ambience2.level, timeConstant);
    const pulse = e.pulse;
    if (pulse.mode === 'breath') {
      this.pulse.setMode('breath', timeConstant);
      this.pulse.setBreath(pulse.pattern, this.breathAnchor, pulse.depth, timeConstant);
    } else if (pulse.mode === 'pattern') {
      this.pulse.setMode('pattern', timeConstant);
      this.pulse.setPattern(pulse.bpm, pulse.complexity, pulse.depth, timeConstant);
    } else {
      this.pulse.setMode('simple', timeConstant);
      this.pulse.setRate(pulse.rate, timeConstant);
      this.pulse.setDepth(pulse.depth, timeConstant);
    }
    this.harmony.setRoot(e.harmony.rootHz, timeConstant);
    this.harmony.setRichness(e.harmony.richness, timeConstant);
    this.harmony.setMovement(e.harmony.movement, timeConstant);
    this.harmony.setSoftness(e.harmony.softness, timeConstant);
    this.harmony.setLevel(e.harmony.level, timeConstant);
    ramp(this.ctx, this.bassShelf.gain, e.bassDb, timeConstant);
    this.reverb.setParams(e.space.level, e.space.size, timeConstant);
    this.width.setWidth(e.stereoWidth, timeConstant);
    ramp(this.ctx, this.lowpass.frequency, e.lowpassHz, timeConstant);
  }
}
