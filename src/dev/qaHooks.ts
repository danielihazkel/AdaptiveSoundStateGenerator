import { AudioEngine } from '../audio/engine';
import { integratedLoudness } from '../audio/loudness';
import { ADAPT_RAMP_TIME_CONSTANT } from '../audio/ramp';
import { analyzeTransition, type TransitionReport } from '../audio/signalMetrics';
import { STATES, type MentalState } from '../audio/states';
import { normalizeProfile, type SoundProfile } from '../audio/types';
import { ChunkSeamer } from '../export/chunkSeamer';
import { renderSessionChunks, routineExportSelection } from '../export/offlineRenderer';
import { CHUNK_CROSSFADE_SEC, EXPORT_SAMPLE_RATE } from '../export/renderTimeline';
import { buildCandidateProfile, candidatesFor, PRIOR_ARM_ID } from '../personalization/candidates';
import { PROGRAM_TYPE_FADE_SEC } from '../programs/evaluator';
import { defaultProgram } from '../programs/types';

/**
 * Dev-only audio QA hooks (loaded from main.tsx under `npm run dev` with
 * `?qa`), driven by the Playwright specs in e2e/*.qa.spec.ts. Renders run on
 * OfflineAudioContexts through the real engine and export path; the audio
 * stays in the page and only metrics cross back to the test.
 */

const SR = EXPORT_SAMPLE_RATE;

export interface RenderSpec {
  state: MentalState;
  intensity?: number;
  /** A personalizer arm; absent = the state default. */
  armId?: string;
  durationSec: number;
  /** 'default' = the state's default 5-phase build program. */
  program?: 'default';
  /** Export chunk length — short chunks put seams where a test can find them. */
  chunkSec?: number;
  /** Override the profile's reverb send. */
  space?: { level: number; size: number };
}

let last: { left: Float32Array; right: Float32Array } | null = null;

function profileFor(spec: Pick<RenderSpec, 'state' | 'intensity' | 'armId' | 'space'>): SoundProfile {
  const profile = buildCandidateProfile(spec.state, spec.intensity ?? 0.5, spec.armId ?? PRIOR_ARM_ID);
  if (spec.space) profile.space = { ...spec.space };
  return normalizeProfile(profile);
}

/** A whole session (arc or program, end fade) through the export's chunk-and-seam path. */
async function render(spec: RenderSpec): Promise<{ seconds: number }> {
  const intensity = spec.intensity ?? 0.5;
  const profile = profileFor(spec);
  const program = spec.program === 'default' ? defaultProgram(spec.state, intensity) : null;
  const seamer = new ChunkSeamer(Math.round(CHUNK_CROSSFADE_SEC * SR), SR);
  const parts: { left: Float32Array; right: Float32Array }[] = [];
  await renderSessionChunks(
    {
      profile: program ? normalizeProfile(program.baseProfile) : profile,
      state: spec.state,
      durationSec: spec.durationSec,
      program,
      chimeEnabled: false,
    },
    (buffer, chunk) => {
      const { start, end } = seamer.seam(buffer, chunk);
      parts.push({
        left: buffer.getChannelData(0).slice(start, end),
        right: buffer.getChannelData(1).slice(start, end),
      });
    },
    () => undefined,
    undefined,
    { chunkSec: spec.chunkSec },
  );
  last = join(parts);
  return { seconds: last.left.length / SR };
}

/**
 * A routine export (Phase 17) through the real chunk-and-seam path: each
 * leg a state default, legs handing over like continueWith. Short chunks
 * let a test put a seam right on a hand-off.
 */
async function renderRoutine(spec: {
  legs: Array<{ state: MentalState; durationSec: number }>;
  chunkSec?: number;
}): Promise<{ seconds: number }> {
  const legs = spec.legs.map((leg) => ({
    profile: profileFor({ state: leg.state }),
    state: leg.state,
    durationSec: leg.durationSec,
    program: null,
  }));
  const volume = legs[0].profile.masterVolume;
  for (const leg of legs) leg.profile.masterVolume = volume;
  const seamer = new ChunkSeamer(Math.round(CHUNK_CROSSFADE_SEC * SR), SR);
  const parts: { left: Float32Array; right: Float32Array }[] = [];
  await renderSessionChunks(
    routineExportSelection(legs, false, { name: 'QA', description: 'qa' }),
    (buffer, chunk) => {
      const { start, end } = seamer.seam(buffer, chunk);
      parts.push({
        left: buffer.getChannelData(0).slice(start, end),
        right: buffer.getChannelData(1).slice(start, end),
      });
    },
    () => undefined,
    undefined,
    { chunkSec: spec.chunkSec },
  );
  last = join(parts);
  return { seconds: last.left.length / SR };
}

/**
 * A steady profile that glides to another mid-render with the adaptation
 * loop's time constant (the arm switch a "worse" check-in triggers).
 */
async function renderGlide(spec: {
  state: MentalState;
  intensity?: number;
  from: string;
  to: string;
  /** A routine hand-off: glide into another state's sound, types dissolving slowly. */
  toState?: MentalState;
  seconds: number;
  switchAt: number;
}): Promise<{ seconds: number }> {
  const a = profileFor({ state: spec.state, intensity: spec.intensity, armId: spec.from });
  const b = profileFor({ state: spec.toState ?? spec.state, intensity: spec.intensity, armId: spec.to });
  b.masterVolume = a.masterVolume; // a switch keeps the user's volume
  last = await renderSteady(a, spec.seconds, (engine, ctx) =>
    ctx.suspend(spec.switchAt).then(() => {
      engine.applyProfile(b, ADAPT_RAMP_TIME_CONSTANT, {
        typeFadeSec: spec.toState ? PROGRAM_TYPE_FADE_SEC : undefined,
      });
      engine.schedulePulsesUntil(spec.seconds);
      void ctx.resume();
    }),
  );
  return { seconds: spec.seconds };
}

/**
 * A steady state-default whose masking side channel (Phase 16) jumps to
 * `gain` mid-render with the live loop's ramp — the worst case of a room
 * that gets loud, without the loop's minute-long smoothing.
 */
async function renderMasking(spec: {
  state: MentalState;
  gain: number;
  seconds: number;
  maskAt: number;
}): Promise<{ seconds: number }> {
  last = await renderSteady(profileFor({ state: spec.state }), spec.seconds, (engine, ctx) =>
    ctx.suspend(spec.maskAt).then(() => {
      engine.setMasking(spec.gain, 2);
      engine.schedulePulsesUntil(spec.seconds);
      void ctx.resume();
    }),
  );
  return { seconds: spec.seconds };
}

/** A profile rendered as-is: no arc, no fade-in. */
async function renderSteady(
  profile: SoundProfile,
  seconds: number,
  schedule?: (engine: AudioEngine, ctx: OfflineAudioContext) => void,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * SR), sampleRate: SR });
  const engine = await AudioEngine.createOffline(profile, ctx);
  try {
    engine.schedulePulsesUntil(seconds);
    await engine.whenAmbienceReady();
    engine.beginOffline({ fadeIn: false });
    schedule?.(engine, ctx);
    const buffer = await ctx.startRendering();
    return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice() };
  } finally {
    engine.dispose();
  }
}

function join(parts: { left: Float32Array; right: Float32Array }[]) {
  const total = parts.reduce((n, p) => n + p.left.length, 0);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    left.set(p.left, at);
    right.set(p.right, at);
    at += p.left.length;
  }
  return { left, right };
}

function slice(range: [number, number], channel: 0 | 1 = 0): Float32Array {
  if (!last) throw new Error('render first');
  const data = channel === 0 ? last.left : last.right;
  return data.subarray(Math.round(range[0] * SR), Math.round(range[1] * SR));
}

function transition(
  before: [number, number],
  during: [number, number],
  after: [number, number],
  channel: 0 | 1 = 0,
): TransitionReport {
  return analyzeTransition(slice(before, channel), slice(during, channel), slice(after, channel), SR);
}

function lufs(range: [number, number]): number {
  return integratedLoudness([slice(range, 0), slice(range, 1)], SR);
}

/**
 * Loudness of every arm at each intensity, as rendered (steady, no arc, the
 * first second skipped while ramps settle) — the input to the loudness
 * calibration table (npm run calibrate:loudness).
 */
async function measureArms(
  opts: {
    seconds?: number;
    intensities?: number[];
    states?: MentalState[];
    arms?: string[];
    /** Measure arms as served (with their calibrated trims) instead of raw. */
    trimmed?: boolean;
  } = {},
) {
  const seconds = opts.seconds ?? 6;
  const intensities = opts.intensities ?? [0, 0.5, 1];
  const states = opts.states ?? (Object.keys(STATES) as MentalState[]);
  const out: Record<string, Record<string, number[]>> = {};
  for (const state of states) {
    out[state] = {};
    for (const arm of candidatesFor(state)) {
      if (opts.arms && !opts.arms.includes(arm.id)) continue;
      out[state][arm.id] = [];
      for (const intensity of intensities) {
        // By default measure the raw recipe: the trims are what this produces.
        const profile = profileFor({ state, intensity, armId: arm.id });
        if (!opts.trimmed) delete profile.loudnessTrimDb;
        const audio = await renderSteady(profile, seconds);
        const from = SR;
        out[state][arm.id].push(
          integratedLoudness([audio.left.subarray(from), audio.right.subarray(from)], SR),
        );
      }
    }
  }
  return out;
}

const hooks = { render, renderRoutine, renderGlide, renderMasking, transition, lufs, measureArms };
export type QaHooks = typeof hooks;
(window as unknown as { __qa: QaHooks }).__qa = hooks;
