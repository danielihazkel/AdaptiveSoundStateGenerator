/**
 * Every audible parameter change must go through here (PRD §7):
 * jumping an AudioParam produces clicks and zipper noise.
 */
export const RAMP_TIME_CONSTANT = 0.05; // seconds; ~63% of the way per constant

/**
 * Slow glide for mid-session adaptation switches (PRD §7: crossfade, never
 * hard-switch): τ = 1 s reads as a ~3–4 s transition to the listener.
 */
export const ADAPT_RAMP_TIME_CONSTANT = 1.0;

/**
 * Session-evolution glide (PRD §12): arc targets refresh every controller
 * tick (500 ms) with τ = 2 s, so the hour-long parameter arcs read as one
 * continuous inaudible drift, never as discrete changes.
 */
export const EVOLUTION_TIME_CONSTANT = 2.0;

export function ramp(
  ctx: BaseAudioContext,
  param: AudioParam,
  value: number,
  timeConstant: number = RAMP_TIME_CONSTANT,
): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}

/** Linear ramp over an exact duration — used for session fade-in/fade-out. */
export function fadeTo(
  ctx: BaseAudioContext,
  param: AudioParam,
  value: number,
  seconds: number,
): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}
