/**
 * Wall-clock elapsed-time accumulator with pause/resume: elapsed is the sum
 * of finished segments plus the live one, so background-tab throttling can
 * never stretch a run and paused time is excluded exactly. Extracted from
 * SessionController so lab program runs share the same timing behavior.
 */
export class ElapsedClock {
  private accumulatedMs = 0;
  private segmentStartedAt = 0;
  private running = false;

  /** Resets to zero and starts counting. */
  start(): void {
    this.accumulatedMs = 0;
    this.segmentStartedAt = Date.now();
    this.running = true;
  }

  /** Freezes elapsed time. No-op if already paused. */
  pause(): void {
    if (!this.running) return;
    this.accumulatedMs += Date.now() - this.segmentStartedAt;
    this.running = false;
  }

  /** Continues counting from the frozen elapsed time. No-op if running. */
  resume(): void {
    if (this.running) return;
    this.segmentStartedAt = Date.now();
    this.running = true;
  }

  elapsedMs(): number {
    const segment = this.running ? Date.now() - this.segmentStartedAt : 0;
    return this.accumulatedMs + segment;
  }
}
