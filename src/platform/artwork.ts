import { STATES, type MentalState } from '../audio/states';

/**
 * Per-state cover art, drawn on a canvas so the app still ships no image
 * per state: a soft two-tone gradient with the state's emoji. Used for the
 * lock-screen / notification card (Media Session) and as the cover of
 * exported MP3s. Falls back to the PWA icon where a canvas is unavailable.
 */

export const ARTWORK_SIZE = 512;
export const FALLBACK_ARTWORK = '/pwa-512x512.png';

/** Gradient stops per state — calm, low-saturation, readable behind white controls. */
const PALETTE: Record<MentalState, readonly [string, string]> = {
  focus: ['#1e3a5f', '#3b6ea8'],
  relax: ['#134e4a', '#2f8f83'],
  sleep: ['#121530', '#33386b'],
  energy: ['#6b2d0f', '#d9771f'],
  meditation: ['#2e1f4f', '#6b51a3'],
  arousal: ['#4a1530', '#a3416b'],
  flow: ['#0f3d4a', '#2b8aa3'],
  calm: ['#1d3b2a', '#4c8a62'],
  creative: ['#4d3a0f', '#c39a2b'],
};

/** One array per state: callers pass it as an effect dependency. */
const artworkByState = new Map<MentalState, MediaImage[]>();

function draw(state: MentalState): HTMLCanvasElement | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = ARTWORK_SIZE;
    canvas.height = ARTWORK_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const [deep, light] = PALETTE[state];
    const half = ARTWORK_SIZE / 2;
    const gradient = ctx.createRadialGradient(half, half * 0.8, 0, half, half, ARTWORK_SIZE * 0.75);
    gradient.addColorStop(0, light);
    gradient.addColorStop(1, deep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ARTWORK_SIZE, ARTWORK_SIZE);
    ctx.font = `${Math.round(ARTWORK_SIZE * 0.42)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(STATES[state].emoji, half, half * 1.04);
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Lock-screen artwork for a state; the PWA icon if drawing fails. Cached:
 * the same array instance comes back on every call for a state.
 */
export function stateArtwork(state: MentalState): MediaImage[] {
  let images = artworkByState.get(state);
  if (!images) {
    let src: string = FALLBACK_ARTWORK;
    try {
      src = draw(state)?.toDataURL('image/png') ?? FALLBACK_ARTWORK;
    } catch {
      src = FALLBACK_ARTWORK;
    }
    images = [{ src, sizes: `${ARTWORK_SIZE}x${ARTWORK_SIZE}`, type: 'image/png' }];
    artworkByState.set(state, images);
  }
  return images;
}

/** The same artwork as PNG bytes (an MP3 cover); null where a canvas is unavailable. */
export async function stateArtworkPng(state: MentalState): Promise<Uint8Array | null> {
  const canvas = draw(state);
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
