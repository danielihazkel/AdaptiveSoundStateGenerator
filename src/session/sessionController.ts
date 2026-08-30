import type { AudioEngine } from '../audio/engine';
import { EVOLUTION_TIME_CONSTANT } from '../audio/ramp';
import { STATES, type MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { evaluateProgram } from '../programs/evaluator';
import type { Program } from '../programs/types';
import { ElapsedClock } from './elapsedClock';
import { resolveEndChime } from './endPolicy';
import { evaluateArc, STATE_ARCS } from './evolution';

export type SessionPhase =
  | 'idle'
  | 'running'
  | 'paused'
  | 'interrupted'
  | 'ending'
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
}

const TICK_MS = 500;

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
  private startedAt = '';
  private readonly clock = new ElapsedClock();
  private interval: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot = { phase: 'idle', elapsedSec: 0, remainingSec: 0 };

  constructor(private readonly engine: AudioEngine) {
    engine.onContextStateChange = (state) => {
      // A suspension we did not initiate (phone call, another app grabbing
      // the output) lands while we still think we are running (PRD §4).
      if (this.snapshot.phase === 'running' && state !== 'running') {
        this.clock.pause();
        this.setPhase('interrupted');
      }
    };
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
    this.startedAt = new Date().toISOString();
    this.clock.start();
    this.nextCheckpointSec = config.checkpointSec ?? Infinity;
    this.checkpointIndex = 0;
    this.engine.applyProfile(config.profile);
    // Begin at the arc/program's t=0 point rather than jumping after the
    // first tick. A plain session must also clear any leftover program
    // modulation (from a prior program session or a lab preview).
    if (config.program) {
      this.engine.setProgramModulation(evaluateProgram(config.program, 0));
    } else {
      this.engine.setProgramModulation(null);
      this.engine.setArcModulation(evaluateArc(STATE_ARCS[config.state], 0));
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
    await this.engine.resume();
    this.clock.resume();
    this.setPhase('running');
  }

  /** Early stop — counts as an implicit negative-ish signal (PRD §9). */
  stop(): void {
    const phase = this.snapshot.phase;
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
    this.listeners.clear();
  }

  private tick(): void {
    const phase = this.snapshot.phase;
    if (phase !== 'running' && phase !== 'ending') return;
    const config = this.config;
    if (!config) return;

    const remainingMs = config.durationSec * 1000 - this.elapsedMs();
    const end = STATES[config.state].end;

    if (phase === 'running' && remainingMs <= end.fadeSeconds * 1000) {
      const chime = resolveEndChime(config.state, config.program, config.chimeEnabled);
      this.engine.endSession(Math.max(remainingMs / 1000, 0.1), chime);
      this.setPhase('ending');
      return;
    }
    if (phase === 'ending' && remainingMs <= 0) {
      clearInterval(this.interval);
      this.clock.pause();
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
      } else {
        this.engine.setArcModulation(
          evaluateArc(
            STATE_ARCS[config.state],
            this.elapsedMs() / (config.durationSec * 1000),
          ),
          EVOLUTION_TIME_CONSTANT,
        );
      }
    }
    this.publish(); // refresh elapsed/remaining for the UI
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
    };
    for (const listener of this.listeners) listener();
  }
}
