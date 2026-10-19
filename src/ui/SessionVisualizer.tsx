import { useEffect, useLayoutEffect, useRef } from 'react';

/** ~30 fps: the glow moves on a breathing timescale; more frames buy nothing. */
const FRAME_MS = 33;
/** Smoothing per frame — the shape follows the sound's swell, not its grain. */
const SMOOTH = 0.92;
/** Below this frequency counts as "body" (bass, brown noise, the pad's root). */
const LOW_BAND_HZ = 250;

/**
 * A slow, soft glow that breathes with what is actually playing (Phase 14):
 * its size follows the output level, its warmth the low-band energy. Reads
 * the engine's analyser tap (AudioEngine.attachAnalyser); draws one static
 * frame under prefers-reduced-motion, and nothing at all without an
 * analyser (the lab, tests).
 */
export function SessionVisualizer(props: {
  getAnalyser: () => AnalyserNode | null;
  /** False while paused: the glow settles instead of reading silence as "quiet". */
  playing: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(props.playing);
  useLayoutEffect(() => {
    playingRef.current = props.playing;
  });
  const { getAnalyser } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = getAnalyser();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !analyser || !ctx) return;
    // The theme accent, as #rrggbb so alpha digits can be appended below.
    const css = getComputedStyle(canvas).getPropertyValue('--accent').trim();
    const accent = /^#[0-9a-f]{6}$/i.test(css) ? css : '#4f7cff';
    const time = new Float32Array(analyser.fftSize);
    const freq = new Float32Array(analyser.frequencyBinCount);
    const lowBins = Math.max(
      1,
      Math.round((LOW_BAND_HZ / (analyser.context.sampleRate / 2)) * analyser.frequencyBinCount),
    );
    let level = 0.3;
    let warmth = 0.5;
    let last = 0;
    let frame = 0;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const radius = (Math.min(width, height) / 2) * (0.45 + 0.5 * level);
      const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(0.35 + 0.4 * warmth, `${accent}55`);
      gradient.addColorStop(1, `${accent}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    const sample = () => {
      analyser.getFloatTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
      const rmsDb = 10 * Math.log10(sum / time.length + 1e-12);
      // −45 dBFS (very quiet) … −10 dBFS (the limiter's ceiling) → 0 … 1.
      const nextLevel = playingRef.current ? Math.min(1, Math.max(0, (rmsDb + 45) / 35)) : 0.2;
      analyser.getFloatFrequencyData(freq);
      let low = 0;
      let all = 0;
      for (let i = 0; i < freq.length; i++) {
        const p = 10 ** (freq[i] / 10);
        all += p;
        if (i < lowBins) low += p;
      }
      const nextWarmth = all > 0 ? Math.min(1, (low / all) * 1.5) : warmth;
      level = SMOOTH * level + (1 - SMOOTH) * nextLevel;
      warmth = SMOOTH * warmth + (1 - SMOOTH) * nextWarmth;
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      draw();
      return;
    }
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      sample();
      draw();
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [getAnalyser]);

  return <canvas ref={canvasRef} className="session-visualizer" width={360} height={200} aria-hidden="true" />;
}
