import { SAMPLE_AMBIENCE_TYPES, type SampleAmbienceType } from './types';

/**
 * Sample-based ambience assets (PRD §6E, post-MVP): forest, fireplace, café.
 * The infrastructure ships now; the sounds activate when someone drops the
 * recordings into public/ambience/ (see the README there). Types with no
 * asset present are hidden from the UI and play silence if selected anyway.
 */

const EXTENSIONS = ['mp3', 'ogg'] as const;

/** Seconds of tail↔head crossfade rendered into the buffer for a seamless loop. */
export const LOOP_XFADE_SEC = 1.5;

function assetUrl(type: SampleAmbienceType, ext: string): string {
  return `${import.meta.env.BASE_URL}ambience/${type}.${ext}`;
}

/**
 * Vite's dev server and most SPA hosts answer *missing* files with 200 +
 * index.html, so a status check proves nothing — require an audio-ish
 * Content-Type. decodeAudioData in loadAmbienceBuffer stays the final word.
 */
async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') ?? '';
    return contentType.startsWith('audio/');
  } catch {
    return false;
  }
}

const urlCache = new Map<SampleAmbienceType, Promise<string | null>>();

function resolveAssetUrl(type: SampleAmbienceType): Promise<string | null> {
  let cached = urlCache.get(type);
  if (!cached) {
    cached = (async () => {
      for (const ext of EXTENSIONS) {
        const url = assetUrl(type, ext);
        if (await probeUrl(url)) return url;
      }
      return null;
    })();
    urlCache.set(type, cached);
  }
  return cached;
}

/** Which sample ambience types have a playable asset shipped. Cached. */
export async function probeSampleAssets(): Promise<ReadonlySet<SampleAmbienceType>> {
  const available = await Promise.all(
    SAMPLE_AMBIENCE_TYPES.map(async (type) => ((await resolveAssetUrl(type)) ? type : null)),
  );
  return new Set(available.filter((t): t is SampleAmbienceType => t !== null));
}

/**
 * Renders an equal-power crossfade of the head into the tail, in place.
 * Looping [crossfadeSamples, length) is then seamless: at the loop end the
 * signal has fully become the head content at `crossfadeSamples`, exactly
 * where the loop jumps to. Returns the loop start in samples.
 */
export function applyLoopCrossfade(
  channels: Float32Array[],
  crossfadeSamples: number,
): number {
  const length = channels[0]?.length ?? 0;
  const fade = Math.min(crossfadeSamples, Math.floor(length / 2));
  const start = length - fade;
  for (const data of channels) {
    for (let i = 0; i < fade; i++) {
      const x = (i + 1) / fade; // 0 → 1 across the seam
      const angle = (x * Math.PI) / 2;
      data[start + i] = data[start + i] * Math.cos(angle) + data[i] * Math.sin(angle);
    }
  }
  return fade;
}

export interface AmbienceLoop {
  buffer: AudioBuffer;
  loopStart: number; // seconds
  loopEnd: number; // seconds
}

const bufferCache = new Map<SampleAmbienceType, Promise<AmbienceLoop | null>>();

/**
 * Fetch + decode + render the loop crossfade. Resolves null when the asset is
 * missing or undecodable — callers treat that as "this type plays silence".
 */
export function loadAmbienceBuffer(
  ctx: BaseAudioContext,
  type: SampleAmbienceType,
): Promise<AmbienceLoop | null> {
  let cached = bufferCache.get(type);
  if (!cached) {
    cached = (async () => {
      try {
        const url = await resolveAssetUrl(type);
        if (!url) return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
          buffer.getChannelData(ch),
        );
        const fadeSamples = applyLoopCrossfade(
          channels,
          Math.round(LOOP_XFADE_SEC * buffer.sampleRate),
        );
        return {
          buffer,
          loopStart: fadeSamples / buffer.sampleRate,
          loopEnd: buffer.duration,
        };
      } catch {
        return null;
      }
    })();
    bufferCache.set(type, cached);
  }
  return cached;
}
