/**
 * Oscillator phase bookkeeping for chunked offline export.
 *
 * Each export chunk renders on a fresh OfflineAudioContext, so every
 * OscillatorNode restarts at phase 0 — a free-running tone or binaural pair
 * would jump at the 2 s seam crossfade. The engine cannot read an
 * oscillator's phase back, but it *can* know it: phase is 2π∫f dt from the
 * node's start time, and every frequency change goes through `ramp()`
 * (cancelScheduledValues + setTargetAtTime), whose trajectory is an exact
 * exponential approach. A tracker mirrors those calls and integrates them,
 * so the previous chunk can hand over "phase at the seam" and the next chunk
 * can delay each oscillator's start() by under one period to land on it.
 *
 * Pure: no Web Audio objects. Times are context seconds; phases are cycles
 * (not radians) so wrapping is `frac()`.
 */

interface Segment {
  /** Segment start time. */
  t: number;
  /** Value at `t`, where the previous segment left off. */
  from: number;
  target: number;
  tau: number;
}

/** One AudioParam driven only by setTargetAtTime — mirrors audio/ramp.ts. */
export class ParamTimeline {
  private readonly segments: Segment[];

  constructor(initial: number) {
    this.segments = [{ t: 0, from: initial, target: initial, tau: 1 }];
  }

  /** Mirror `ramp(param, target, tau)` issued at `time` (non-decreasing). */
  set(time: number, target: number, tau: number): void {
    const from = this.valueAt(time);
    this.segments.push({ t: time, from, target, tau: Math.max(tau, 1e-6) });
  }

  /** Index of the segment active at `t`. */
  segmentAt(t: number): number {
    let i = this.segments.length - 1;
    while (i > 0 && this.segments[i].t > t) i -= 1;
    return i;
  }

  valueIn(index: number, t: number): number {
    const s = this.segments[index];
    return s.target + (s.from - s.target) * Math.exp(-(t - s.t) / s.tau);
  }

  valueAt(t: number): number {
    return this.valueIn(this.segmentAt(t), t);
  }

  /** Every segment start time — the breakpoints an integrator must respect. */
  breakpoints(): number[] {
    return this.segments.map((s) => s.t);
  }
}

/** Integration step inside one breakpoint interval (Simpson's rule). */
const INTEGRATION_STEP_SEC = 0.002;

/**
 * Frequency + detune of one OscillatorNode over a chunk. `cyclesAt(t)` is
 * ∫₀ᵗ f(s)·2^(detune(s)/1200) ds; `phaseAt(t)` subtracts the cycles that
 * elapsed before the node's (possibly delayed) start.
 */
export class OscillatorPhaseTracker {
  readonly frequency: ParamTimeline;
  readonly detune: ParamTimeline;
  private startDelay = 0;

  constructor(hz: number, cents = 0) {
    this.frequency = new ParamTimeline(hz);
    this.detune = new ParamTimeline(cents);
  }

  setFrequency(time: number, hz: number, tau: number): void {
    this.frequency.set(time, hz, tau);
  }

  setDetune(time: number, cents: number, tau: number): void {
    this.detune.set(time, cents, tau);
  }

  /** The node was started at `delay` seconds — phase counts from there. */
  start(delay: number): void {
    this.startDelay = Math.max(0, delay);
  }

  hzAt(t: number): number {
    return this.frequency.valueAt(t) * Math.pow(2, this.detune.valueAt(t) / 1200);
  }

  /** Cycles accumulated from context time 0 to `t` (ignores the start delay). */
  cyclesAt(t: number): number {
    if (t <= 0) return 0;
    const points = [...new Set([...this.frequency.breakpoints(), ...this.detune.breakpoints(), 0, t])]
      .filter((p) => p >= 0 && p <= t)
      .sort((a, b) => a - b);
    let total = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (b <= a) continue;
      total += this.integrateInterval(a, b);
    }
    return total;
  }

  /** Cycles since the node started — its phase, in cycles. */
  phaseAt(t: number): number {
    if (t <= this.startDelay) return 0;
    return this.cyclesAt(t) - this.cyclesAt(this.startDelay);
  }

  /** Simpson over [a, b) where both params follow a single exponential. */
  private integrateInterval(a: number, b: number): number {
    const fi = this.frequency.segmentAt(a);
    const di = this.detune.segmentAt(a);
    const g = (s: number) =>
      this.frequency.valueIn(fi, s) * Math.pow(2, this.detune.valueIn(di, s) / 1200);
    let n = Math.ceil((b - a) / INTEGRATION_STEP_SEC);
    if (n < 2) n = 2;
    if (n % 2 === 1) n += 1;
    const h = (b - a) / n;
    let sum = g(a) + g(b);
    for (let k = 1; k < n; k++) sum += (k % 2 === 1 ? 4 : 2) * g(a + k * h);
    return (sum * h) / 3;
  }
}

export function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * The start delay (< one period, ≥ 0) that makes an oscillator accumulate
 * exactly `cycles` ∈ [0, 1) fewer cycles than an undelayed one — i.e. shifts
 * its phase by −cycles. Bisection on the tracker's own integral, so the
 * frequency ramp that may be in flight during the delay is accounted for.
 */
export function solveStartDelay(tracker: OscillatorPhaseTracker, cycles: number): number {
  const want = frac(cycles);
  if (want < 1e-9) return 0;
  let hi = 1 / Math.max(tracker.hzAt(0), 1);
  for (let i = 0; i < 20 && tracker.cyclesAt(hi) < want; i++) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (tracker.cyclesAt(mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Delays for the next chunk's oscillators so that at context time `alignAt`
 * each one sits on the phase (`targets`, cycles) the previous chunk reported
 * for the same absolute instant.
 */
export function alignmentDelays(
  trackers: readonly OscillatorPhaseTracker[],
  targets: readonly number[],
  alignAt: number,
): number[] {
  return trackers.map((tracker, i) => {
    const target = targets[i];
    if (target === undefined || !Number.isFinite(target)) return 0;
    return solveStartDelay(tracker, frac(tracker.cyclesAt(alignAt) - target));
  });
}
