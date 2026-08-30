/**
 * A looping, silent <audio> element played alongside the Web Audio graph.
 * Browsers key two things off an HTMLMediaElement that pure Web Audio does
 * not trigger: Media Session controls on the lock screen (Chrome/Android),
 * and background/locked-screen playback on iOS. Keeping this element playing
 * for the life of a session is the standard workaround for both.
 *
 * The clip is a 1 s 8 kHz mono 8-bit PCM WAV of digital silence (~8 KB as a
 * data URI), generated once on first use.
 */
let element: HTMLAudioElement | null = null;

function silentWavDataUri(seconds = 1, sampleRate = 8000): string {
  const samples = seconds * sampleRate;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit PCM silence is the unsigned midpoint
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function ensureElement(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  if (!element) {
    element = document.createElement('audio');
    element.src = silentWavDataUri();
    element.loop = true;
    element.preload = 'auto';
    element.setAttribute('playsinline', '');
    element.setAttribute('aria-hidden', 'true');
    element.style.display = 'none';
    document.body.appendChild(element);
  }
  return element;
}

/**
 * Start (or keep) the keep-alive playing. Call synchronously inside the user
 * gesture that starts a session — iOS only honours play() from a gesture.
 */
export function playSilentKeepAlive(): void {
  const el = ensureElement();
  if (!el || !el.paused) return;
  void el.play().catch(() => undefined);
}

export function stopSilentKeepAlive(): void {
  if (!element || element.paused) return;
  element.pause();
}
