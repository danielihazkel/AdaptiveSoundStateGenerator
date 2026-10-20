import { melodyNotesBetween } from '../melody';
import { ramp } from '../ramp';

/** Realtime lookahead, like the pattern pulse scheduler. */
const SCHEDULER_TICK_MS = 100;
const SCHEDULE_HORIZON_SEC = 1.2;
/** Pluck envelope: a short linear attack (never a click), then a bell-like decay. */
export const MELODY_ATTACK_SEC = 0.008;
const DECAY_TAU_SEC = 0.6;
/** A note is silent (−52 dB) this long after its attack; its voices stop then. */
const NOTE_LIFETIME_SEC = MELODY_ATTACK_SEC + 6 * DECAY_TAU_SEC;
/** Peak of a full-velocity note into the layer bus (the bus gain is the level). */
const NOTE_PEAK = 0.5;
/** Upper partial at brightness 1, relative to the fundamental. */
const MAX_PARTIAL_GAIN = 0.35;
/** Below this the layer is off: no voices are created at all. */
const SILENT_LEVEL = 1e-4;

/**
 * Generative melody (Phase 17): sparse plucks placed by melody.ts, each a
 * sine plus a soft octave partial through a fast-attack, exponential-decay
 * envelope, into a level bus. Every note's time comes from absolute session
 * time (ctx time + clockOffsetSec), so an export chunk that starts at
 * session second 900 plays exactly the notes the previous chunk would have.
 * Realtime engines schedule ahead on a timer; offline ones are driven with
 * scheduleUntil() from the render checkpoints.
 */
export class MelodyLayer {
  private readonly bus: GainNode;
  private level = 0;
  private density = 3;
  private brightness = 0.4;
  private rootHz = 110;
  /** Absolute session seconds at ctx time 0 (offline chunks start mid-session). */
  private clockOffsetSec = 0;
  /** Absolute time up to which notes have been considered. */
  private scheduledUntilAbs: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly voices = new Set<OscillatorNode>();

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly offline: boolean,
  ) {
    this.bus = new GainNode(ctx, { gain: 0 });
    this.bus.connect(destination);
  }

  setLevel(level: number, timeConstant?: number): void {
    this.level = level;
    ramp(this.ctx, this.bus.gain, level, timeConstant);
    // Realtime: the lookahead timer runs only while the melody can sound —
    // a disabled layer (the usual case) costs no wakeups at all.
    if (this.offline) return;
    if (level > SILENT_LEVEL && this.timer === undefined) {
      this.scheduledUntilAbs = null;
      this.timer = setInterval(
        () => this.scheduleUntil(this.ctx.currentTime + SCHEDULE_HORIZON_SEC),
        SCHEDULER_TICK_MS,
      );
    } else if (level <= SILENT_LEVEL && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  setParams(params: { density: number; brightness: number; rootHz: number }): void {
    this.density = params.density;
    this.brightness = params.brightness;
    this.rootHz = params.rootHz;
  }

  /** Offline chunks: which session second ctx time 0 is. Call before scheduling. */
  setClockOffset(sec: number): void {
    this.clockOffsetSec = sec;
    this.scheduledUntilAbs = null;
  }

  /** Create the voices for every note up to `untilCtx` (ctx seconds). */
  scheduleUntil(untilCtx: number): void {
    const now = this.ctx.currentTime;
    const untilAbs = untilCtx + this.clockOffsetSec;
    const fromAbs = this.scheduledUntilAbs ?? now + this.clockOffsetSec;
    if (untilAbs <= fromAbs) return;
    this.scheduledUntilAbs = untilAbs;
    if (this.level <= SILENT_LEVEL || this.density <= 0) return;
    for (const note of melodyNotesBetween(fromAbs, untilAbs, this.density, this.rootHz)) {
      const at = note.time - this.clockOffsetSec;
      // A slot's note may be nudged past the window start; never schedule in the past.
      if (at < now) continue;
      this.playNote(at, note.frequency, note.velocity);
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        // not started yet / already stopped
      }
      voice.disconnect();
    }
    this.voices.clear();
    this.bus.disconnect();
  }

  private playNote(at: number, frequency: number, velocity: number): void {
    const ctx = this.ctx;
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(NOTE_PEAK * velocity, at + MELODY_ATTACK_SEC);
    env.gain.setTargetAtTime(0, at + MELODY_ATTACK_SEC, DECAY_TAU_SEC);
    env.connect(this.bus);
    const fundamental = new OscillatorNode(ctx, { frequency });
    fundamental.connect(env);
    const partial = new OscillatorNode(ctx, { frequency: frequency * 2 });
    const partialGain = new GainNode(ctx, { gain: MAX_PARTIAL_GAIN * this.brightness });
    partial.connect(partialGain).connect(env);
    const end = at + NOTE_LIFETIME_SEC;
    for (const osc of [fundamental, partial]) {
      osc.start(at);
      osc.stop(end);
      this.voices.add(osc);
    }
    fundamental.onended = () => {
      for (const node of [fundamental, partial, partialGain, env]) node.disconnect();
      this.voices.delete(fundamental);
      this.voices.delete(partial);
    };
  }
}
