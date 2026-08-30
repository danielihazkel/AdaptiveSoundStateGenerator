import type { AudioEngine } from '../audio/engine';
import { EVOLUTION_TIME_CONSTANT } from '../audio/ramp';
import type { BreathPattern } from '../audio/breathing';
import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { evaluateProgram, segmentAt } from '../programs/evaluator';
import type { Program } from '../programs/types';
import { ElapsedClock } from './elapsedClock';
import { resolveEndChime, resolveEndFadeSeconds } from './endPolicy';
import { evaluateArc, resolveArc, type WakeUp } from './evolution';

export type SessionPhase =
  | 'idle'
  | 'running'
  | 'paused'
  | 'interrupted'
  | 'ending'
  /** Wake-up alarm ringing after the end fade; ends on dismiss/snooze/timeout. */
  | 'alarm'
  | 'finished'
  | 'stoppedEarly';

export interface SessionConfig {
  state: MentalState;
  intensity: number;
  durationSec: number;
  profile: SoundProfile;
  presetId?: string;
  /** Replaying the exact sound of an earlier session (history screen). */
  replayOfSessionId?: string;
  /**
   * Timed program driving the session shape. When set it replaces the
   * per-state evolution arc; `state` should be the program's baseState so the
   * end fade and warnings stay coherent.
   */
  program?: Program;
  /** Only meaningful when the state's end.chime is 'optional'. */
  chimeEnabled: boolean;
  /**
   * Guided breathing: the mix swells with this pattern (engine side channel,
   * never part of the profile). Ignored when a program is set.
   */
  breathing?: BreathPattern;
  /** Close the session with a gentle rise and a chime (sleep alarm). Plain sessions only. */
  wakeUp?: WakeUp;
  /** Interval between adaptation checkpoints; omit to disable them. */
  checkpointSec?: number;
  /** No checkpoint fires with less than this much session time left. */
  endGuardSec?: number;
}

export interface CheckpointInfo {
  /** 0-based ordinal of this checkpoint within the session. */
  index: number;
  elapsedSec: number;
}

/** Draft handed to the UI when a session ends — persistence turns it into a SessionRecord. */
export interface SessionResult {
  config: SessionConfig;
  startedAt: string; // ISO timestamp
  actualDurationSec: number;
  completed: boolean;
}

export interface SessionSnapshot {
  phase: SessionPhase;
  elapsedSec: number;
  remainingSec: number;
  /** The last resume() could not restart audio (context refused to resume). */
  resumeFailed?: boolean;
}

const TICK_MS = 500;
/** "+15 min" from the session screen. */
export const EXTEND_SEC = 15 * 60;
/** Snooze length after the wake-up alarm. */
export const SNOOZE_SEC = 5 * 60;
/** The alarm gives up (session completes) if nobody dismisses it. */
export const ALARM_MAX_SEC = 120;

/**
 * Owns the session lifecycle: wall-clock timer, pause/resume, interruption
 * recovery, and the per-state end behavior (sleep's 60s fade starts at
 * T−60s so silence lands exactly at the planned end — no chime; PRD §4).
 *
 * The timer is wall-clock based (segment start + accumulated ms); the tick
 * interval only refreshes the UI and detects the end, so background-tab
 * throttling cannot stretch a session.
 */
export class SessionController {
  onComplete: ((result: SessionResult) => void) | undefined;
  /** Fired every config.checkpointSec of listening time (PRD §17). */
  onCheckpoint: ((info: CheckpointInfo) => void) | undefined;

  private config: SessionConfig | undefined;
  private nextCheckpointSec = Infinity;
  private checkpointIndex = 0;
  /** Program phase last seen by tick(), for boundary chimes. */
  private segmentIndex = 0;
  private startedAt = '';
  private readonly clock = new ElapsedClock();
  private interval: ReturnType<typeof setInterval> | undefined;
  private alarmTimeout: ReturnType<typeof setTimeout> | undefined;
  private resumeFailed = false;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot = { phase: 'idle', elapsedSec: 0, remainingSec: 0 };
  private readonly unsubscribeContextState: () => void;

  constructor(private readonly engine: AudioEngine) {
    this.unsubscribeContextState = engine.subscribeContextState((state) => {
      // A suspension we did not initiate (phone call, another app grabbing
      // the output) lands while we still think we are running (PRD §4).
      if (this.snapshot.phase === 'running' && state !== 'running') {
        this.clock.pause();
        this.setPhase('interrupted');
      }
    });
  }

  get phase(): SessionPhase {
    return this.snapshot.phase;
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(config: SessionConfig): Promise<void> {
    this.config = config;
    this.resumeFailed = false;
    this.startedAt = new Date().toISOString();
    this.clock.start();
    this.nextCheckpointSec = config.checkpointSec ?? Infinity;
    this.checkpointIndex = 0;
    this.segmentIndex = 0;
    this.engine.applyProfile(config.profile);
    this.engine.setBreathPattern(config.program ? null : (config.breathing ?? null));
    // Begin at the arc/program's t=0 point rather than jumping after the
    // first tick. A plain session must also clear any leftover program
    // modulation (from a prior program session or a lab preview).
    if (config.program) {
      this.engine.setProgramModulation(evaluateProgram(config.program, 0));
    } else {
      this.engine.setProgramModulation(null);
      this.engine.setArcModulation(evaluateArc(this.arc(config), 0));
    }
    await this.engine.start();
    clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), TICK_MS);
    this.setPhase('running');
  }

  async pause(): Promise<void> {
    if (this.snapshot.phase !== 'running') return;
    this.clock.pause();
    this.setPhase('paused');
    await this.engine.pause();
  }

  async resume(): Promise<void> {
    const phase = this.snapshot.phase;
    if (phase !== 'paused' && phase !== 'interrupted') return;
    try {
      await this.engine.resume();
    } catch (err) {
      // iOS refuses resume() while 'interrupted'; any browser refuses one
      // that isn't tied to a gesture. Stay put and let the UI say so.
      console.warn('Audio could not resume', err);
      this.resumeFailed = true;
      this.publish();
      return;
    }
    this.resumeFailed = false;
    this.clock.resume();
    this.setPhase('running');
  }

  /**
   * Add listening time to a plain session ("+15 min"). During the wind-down
   * the end fade is cancelled and the sound fades back in. Programs have a
   * fixed shape and are not extendable.
   */
  async extend(sec: number = EXTEND_SEC): Promise<void> {
    const phase = this.snapshot.phase;
    const config = this.config;
    if (!config || config.program || (phase !== 'running' && phase !== 'ending')) return;
    config.durationSec += sec;
    if (phase === 'ending') {
      await this.engine.start();
      this.setPhase('running');
    } else {
      this.publish();
    }
  }

  /** The wake-up alarm was heard: end the session as completed. */
  dismissAlarm(): void {
    if (this.snapshot.phase !== 'alarm') return;
    clearTimeout(this.alarmTimeout);
    this.engine.stopAlarm();
    this.setPhase('finished');
    this.emitResult(true);
  }

  /** Silence the alarm and keep sleeping a little longer; it rings again after. */
  async snooze(sec: number = SNOOZE_SEC): Promise<void> {
    const config = this.config;
    if (!config || this.snapshot.phase !== 'alarm') return;
    clearTimeout(this.alarmTimeout);
    this.engine.stopAlarm({ suspend: false });
    config.durationSec += sec;
    this.clock.resume();
    await this.engine.start();
    clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), TICK_MS);
    this.setPhase('running');
  }

  /** Early stop — counts as an implicit negative-ish signal (PRD §9). */
  stop(): void {
    const phase = this.snapshot.phase;
    if (phase === 'alarm') {
      this.dismissAlarm();
      return;
    }
    if (phase !== 'running' && phase !== 'paused' && phase !== 'interrupted') return;
    this.clock.pause();
    clearInterval(this.interval);
    this.engine.stop();
    this.setPhase('stoppedEarly');
    this.emitResult(false);
  }

  /**
   * The only mid-session sound-change entry point (adaptation loop). The
   * phase guard structurally protects the end/pause fades: applying a profile
   * during 'ending'/'paused' would cancel their in-flight master-gain ramps.
   */
  applyProfile(profile: SoundProfile, timeConstant?: number): void {
    if (this.snapshot.phase !== 'running' || !this.config) return;
    this.config.profile = profile;
    this.engine.applyProfile(profile, timeConstant);
  }

  dispose(): void {
    clearInterval(this.interval);
    clearTimeout(this.alarmTimeout);
    this.unsubscribeContextState();
    this.listeners.clear();
  }

  private tick(): void {
    const phase = this.snapshot.phase;
    if (phase !== 'running' && phase !== 'ending') return;
    const config = this.config;
    if (!config) return;

    const remainingMs = config.durationSec * 1000 - this.elapsedMs();
    const wakeUp = !config.program && config.wakeUp !== undefined;
    const fadeSeconds = resolveEndFadeSeconds(config.state, wakeUp);

    if (phase === 'running' && remainingMs <= fadeSeconds * 1000) {
      const chime = resolveEndChime(config.state, config.program, config.chimeEnabled, wakeUp);
      this.engine.endSession(Math.max(remainingMs / 1000, 0.1), chime);
      this.setPhase('ending');
      return;
    }
    if (phase === 'ending' && remainingMs <= 0) {
      clearInterval(this.interval);
      this.clock.pause();
      if (wakeUp) {
        // The rise has landed: ring until dismissed (or the cap), then finish.
        this.engine.startAlarm();
        this.setPhase('alarm');
        this.alarmTimeout = setTimeout(() => this.dismissAlarm(), ALARM_MAX_SEC * 1000);
        return;
      }
      this.setPhase('finished');
      this.emitResult(true);
      return;
    }

    const elapsedSec = this.elapsedMs() / 1000;
    if (phase === 'running' && elapsedSec >= this.nextCheckpointSec) {
      const info: CheckpointInfo = {
        index: this.checkpointIndex,
        elapsedSec: Math.round(elapsedSec),
      };
      this.checkpointIndex += 1;
      this.nextCheckpointSec += config.checkpointSec ?? Infinity;
      // A checkpoint landing inside the end guard is skipped, not deferred —
      // a switch this late could not be judged before the session ends.
      if (remainingMs / 1000 > (config.endGuardSec ?? 0)) {
        this.onCheckpoint?.(info);
      }
    }

    // Session evolution (PRD §12): drift the engine toward this moment's
    // arc/program point. Only while 'running' — the wind-down branch above
    // returns before reaching here, so no modulation update ever lands on an
    // 'ending' tick, and the end fade owns the finish. Wall-clock elapsed
    // keeps pause/resume exact.
    if (phase === 'running') {
      if (config.program) {
        this.engine.setProgramModulation(
          evaluateProgram(config.program, this.elapsedMs() / 1000),
          EVOLUTION_TIME_CONSTANT,
        );
        // Phase boundary cue (interval programs): once per crossing, never
        // during the end fade (this branch is 'running' only).
        const { index } = segmentAt(config.program, this.elapsedMs() / 1000);
        if (index !== this.segmentIndex) {
          this.segmentIndex = index;
          if (config.program.boundaryChime) this.engine.playCue();
        }
      } else {
        this.engine.setArcModulation(
          evaluateArc(this.arc(config), this.elapsedMs() / (config.durationSec * 1000)),
          EVOLUTION_TIME_CONSTANT,
        );
      }
    }
    this.publish(); // refresh elapsed/remaining for the UI
  }

  private arc(config: SessionConfig) {
    return resolveArc(config.state, { wakeUp: config.wakeUp, durationSec: config.durationSec });
  }

  private elapsedMs(): number {
    return this.clock.elapsedMs();
  }

  private emitResult(completed: boolean): void {
    if (!this.config) return;
    this.onComplete?.({
      config: this.config,
      startedAt: this.startedAt,
      actualDurationSec: Math.round(this.clock.elapsedMs() / 1000),
      completed,
    });
  }

  private setPhase(phase: SessionPhase): void {
    this.publish(phase);
  }

  private publish(phase: SessionPhase = this.snapshot.phase): void {
    const elapsedSec = Math.min(
      Math.round(this.elapsedMs() / 1000),
      this.config?.durationSec ?? 0,
    );
    this.snapshot = {
      phase,
      elapsedSec,
      remainingSec: Math.max((this.config?.durationSec ?? 0) - elapsedSec, 0),
      ...(this.resumeFailed ? { resumeFailed: true } : {}),
    };
    for (const listener of this.listeners) listener();
  }
}
