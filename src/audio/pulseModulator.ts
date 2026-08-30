import {
  breathEnvelopeAt,
  levelBeforePhase,
  patternPeriodSec,
  type BreathPattern,
} from './breathing';
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
/** Segments per breath inhale/exhale ramp (4-8 s long, so 8 is plenty). */
const BREATH_SEGMENTS = 8;

/** The profile's two rhythm modes plus the guided-breathing side channel. */
type PulseMode = RhythmMode | 'breath';

/** One scheduled pulse, in absolute (session) seconds. */
interface ScheduledPulse {
  start: number;
  width: number;
  peak: number;
}

/**
 * Rhythm state carried from one offline render chunk to the next: pulses
 * already scheduled past the seam (re-issued verbatim in the next chunk) and
 * the next unscheduled pulse, so the bar continues exactly where it was.
 * Bar phase is the integral of a drifting BPM — a fresh engine cannot
 * re-derive it from absolute time alone.
 */
export interface PulseHandover {
  scheduled: ScheduledPulse[];
  next: { eventIdx: number; eventTime: number; barEvents: PulseEvent[] } | null;
}

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
 * Breath mode (guided breathing, engine side channel): the same
 * patternSource.offset carries a slow 0..1 breath envelope — raised-cosine
 * up over the inhale, flat through holds, down over the exhale — but with
 * patternDepthGain at +depth and input at 1 - depth, so the mix is loudest
 * at the top of the breath: gain = 1 - depth + depth·env ∈ [1 - depth, 1].
 * Cycles are scheduled whole from an anchor time, so the envelope is a pure
 * function of time (the on-screen pacer computes the same function) and a
 * pattern change takes effect from the next unscheduled cycle.
 *
 * Mode switches crossfade the depth paths via ramps — no graph changes.
 */
export class PulseModulator {
  readonly input: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly depthGain: GainNode;
  private readonly patternSource: ConstantSourceNode;
  private readonly patternDepthGain: GainNode;

  private mode: PulseMode = 'simple';
  private depth: number;
  private bpm = 80;
  private complexity = 0;
  private breath: BreathPattern | null = null;
  /** ctx time of breath cycle 0. */
  private breathAnchor = 0;
  /** ctx time up to which the breath envelope has been scheduled. */
  private breathScheduledUntil = -Infinity;

  private schedulerTimer: ReturnType<typeof setInterval> | undefined;
  private barEvents: PulseEvent[] = [];
  private eventIdx = 0;
  /** AudioContext time of barEvents[eventIdx] — the next unscheduled pulse. */
  private eventTime = 0;
  /** Offline only: every envelope scheduled (ctx time), for chunk handover. */
  private scheduledLog: ScheduledPulse[] = [];

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

  /** Crossfades between the sine-LFO, scheduled-pattern, and breath paths. */
  setMode(mode: PulseMode, timeConstant?: number): void {
    if (this.mode === mode) return;
    const wasScheduled = this.mode !== 'simple';
    this.mode = mode;
    // Pattern pulses and breath cycles share patternSource.offset; a switch
    // between them must clear the other's pending automation. Mode switches
    // are rare (session start, profile edits) and the depth-gain crossfade
    // through zero hides the reset — the never-cancel rule is about
    // parameter changes *within* a mode.
    if (wasScheduled && mode !== 'simple') this.resetOffsetAutomation();
    if (mode === 'pattern') {
      ramp(this.ctx, this.depthGain.gain, 0, timeConstant);
      ramp(this.ctx, this.input.gain, 1, timeConstant);
      ramp(this.ctx, this.patternDepthGain.gain, -this.depth, timeConstant);
      this.resetBar();
      this.startScheduler();
    } else if (mode === 'breath') {
      ramp(this.ctx, this.depthGain.gain, 0, timeConstant);
      ramp(this.ctx, this.input.gain, 1 - this.depth, timeConstant);
      ramp(this.ctx, this.patternDepthGain.gain, this.depth, timeConstant);
      this.breathScheduledUntil = -Infinity;
      this.startScheduler();
    } else {
      this.stopScheduler();
      ramp(this.ctx, this.patternDepthGain.gain, 0, timeConstant);
      ramp(this.ctx, this.depthGain.gain, this.depth / 2, timeConstant);
      ramp(this.ctx, this.input.gain, 1 - this.depth / 2, timeConstant);
    }
  }

  /**
   * Breath-path targets. The pattern applies from the next unscheduled
   * cycle; the anchor is the ctx time of cycle 0 (shared with the pacer via
   * session elapsed time). Depth ramps independently of the envelope.
   */
  setBreath(
    pattern: BreathPattern,
    anchorCtxTime: number,
    depth: number,
    timeConstant?: number,
  ): void {
    this.breath = pattern;
    this.breathAnchor = anchorCtxTime;
    this.depth = depth;
    if (this.mode !== 'breath') return;
    ramp(this.ctx, this.patternDepthGain.gain, depth, timeConstant);
    ramp(this.ctx, this.input.gain, 1 - depth, timeConstant);
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
    if (!this.offline) return;
    if (this.mode === 'pattern') this.scheduleWindow(until);
    else if (this.mode === 'breath') this.scheduleBreathWindow(until);
  }

  /**
   * Offline chunk handover, part 1: pulses whose envelope reaches past
   * `fromCtxTime` and the next-pulse state, converted to absolute time via
   * `ctxToAbs` (absolute = ctx + ctxToAbs).
   */
  exportHandover(fromCtxTime: number, ctxToAbs: number): PulseHandover {
    const scheduled = this.scheduledLog
      .filter((p) => p.start + p.width >= fromCtxTime)
      .map((p) => ({ ...p, start: p.start + ctxToAbs }));
    const next =
      this.offline && this.mode === 'pattern'
        ? {
            eventIdx: this.eventIdx,
            eventTime: this.eventTime + ctxToAbs,
            barEvents: this.barEvents.map((e) => ({ ...e })),
          }
        : null;
    return { scheduled, next };
  }

  /**
   * Offline chunk handover, part 2: call after the profile/modulation for the
   * chunk's origin has been applied (so the mode is settled). Re-issues the
   * handed-over pulses that start inside this context and resumes the bar
   * from the handed-over next-pulse state. No-op unless in pattern mode.
   */
  importHandover(handover: PulseHandover, absToCtx: number): void {
    if (!this.offline || this.mode !== 'pattern') return;
    const now = this.ctx.currentTime;
    for (const p of handover.scheduled) {
      const start = p.start + absToCtx;
      if (start >= now) this.scheduleEnvelope(start, p.width, p.peak);
    }
    if (handover.next) {
      this.eventIdx = handover.next.eventIdx;
      this.eventTime = handover.next.eventTime + absToCtx;
      this.barEvents = handover.next.barEvents.map((e) => ({ ...e }));
    }
  }

  /** Restart the bar from "now" — on entering pattern mode. */
  private resetBar(): void {
    this.barEvents = buildBar(this.complexity);
    this.eventIdx = 0;
    this.eventTime = this.ctx.currentTime + 0.05;
  }

  private startScheduler(): void {
    if (this.offline) return; // driven externally via scheduleAheadUntil
    if (this.schedulerTimer !== undefined) {
      this.schedulerTick();
      return;
    }
    this.schedulerTimer = setInterval(() => this.schedulerTick(), SCHEDULER_TICK_MS);
    this.schedulerTick();
  }

  /** Drop pending offset automation and pin the value — only across mode switches. */
  private resetOffsetAutomation(): void {
    const now = this.ctx.currentTime;
    const offset = this.patternSource.offset;
    if (typeof offset.cancelAndHoldAtTime === 'function') {
      offset.cancelAndHoldAtTime(now);
    } else {
      offset.cancelScheduledValues(now);
    }
    offset.setValueAtTime(0, now + 0.05);
    this.scheduledLog = [];
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
    if (this.mode === 'breath') {
      this.scheduleBreathWindow(now + SCHEDULE_HORIZON_SEC);
      return;
    }
    if (this.mode !== 'pattern') return;
    // Catch up without scheduling after suspension or a starved interval.
    while (this.eventTime < now) this.advance();
    this.scheduleWindow(now + SCHEDULE_HORIZON_SEC);
  }

  /**
   * Schedule every breath cycle that starts before `until`, whole. On a
   * fresh start (or after a gap — the context was suspended under us) the
   * envelope is pinned at its current value first and the remainder of the
   * in-progress cycle is scheduled from there, so a chunk or a resume that
   * lands mid-cycle is still correct.
   */
  private scheduleBreathWindow(until: number): void {
    const pattern = this.breath;
    if (!pattern) return;
    const period = patternPeriodSec(pattern);
    if (!(period > 0)) return;
    const now = this.ctx.currentTime;
    let from = this.breathScheduledUntil;
    if (from < now) {
      from = now;
      this.patternSource.offset.setValueAtTime(
        breathEnvelopeAt(pattern, now - this.breathAnchor),
        now,
      );
    }
    while (from < until) {
      const cycleStart =
        this.breathAnchor + Math.floor((from - this.breathAnchor) / period) * period;
      this.scheduleBreathCycle(pattern, cycleStart, from);
      from = cycleStart + period;
    }
    this.breathScheduledUntil = from;
  }

  /** Ramps for one cycle starting at `cycleStart`, skipping points at or before `from`. */
  private scheduleBreathCycle(pattern: BreathPattern, cycleStart: number, from: number): void {
    const offset = this.patternSource.offset;
    let t = cycleStart;
    pattern.phases.forEach((phase, index) => {
      const start = t;
      const end = t + phase.seconds;
      t = end;
      if (end <= from) return;
      if (phase.label === 'hold') {
        offset.linearRampToValueAtTime(levelBeforePhase(pattern, index), end);
        return;
      }
      for (let k = 1; k <= BREATH_SEGMENTS; k++) {
        const time = start + (phase.seconds * k) / BREATH_SEGMENTS;
        if (time <= from) continue;
        const e = 0.5 * (1 - Math.cos((Math.PI * k) / BREATH_SEGMENTS));
        offset.linearRampToValueAtTime(phase.label === 'in' ? e : 1 - e, time);
      }
    });
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
    if (this.offline) this.scheduledLog.push({ start, width, peak });
    const offset = this.patternSource.offset;
    offset.setValueAtTime(0, start);
    for (let k = 1; k <= ENVELOPE_SEGMENTS; k++) {
      const value = peak * 0.5 * (1 - Math.cos((2 * Math.PI * k) / ENVELOPE_SEGMENTS));
      offset.linearRampToValueAtTime(value, start + (width * k) / ENVELOPE_SEGMENTS);
    }
  }
}
