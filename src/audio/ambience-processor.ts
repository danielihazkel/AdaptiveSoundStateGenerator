/**
 * AudioWorklet synthesized-ambience generator (PRD §6E).
 *
 * Rain, ocean, wind and space are all shaped noise — no audio files, so they
 * work fully offline. Like the noise processor, the source ships as a string
 * loaded through a Blob URL (survives Vite dev + build with no bundler
 * worklet handling) and must stay self-contained plain JavaScript.
 *
 * The swell/gust modulators live inside the processor as per-sample phase
 * accumulators: sample-accurate and immune to background-tab timer
 * throttling. Channels keep independent generator state (decorrelated =
 * wide), with slow-LFO phases offset per channel. Type switches crossfade
 * equal-power over ~100 ms inside the processor, so setType is click-free.
 */
export const AMBIENCE_PROCESSOR_NAME = 'resonance-ambience';

const processorSource = /* js */ `
const TYPES = ['rain', 'ocean', 'wind', 'space'];
const FADE_SECONDS = 0.1;
const TWO_PI = Math.PI * 2;

function onePoleCoeff(cutoffHz) {
  return Math.exp((-TWO_PI * cutoffHz) / sampleRate);
}

function makeState(type, ch) {
  // Per-channel LFO phases start offset so left/right breathe out of step.
  const off = ch * 2.1;
  if (type === 'rain') {
    return {
      hp: 0, lpHiss: 0, lpDrop: 0, dropEnv: 0,
      aHp: onePoleCoeff(2000), aHiss: onePoleCoeff(8000), aDrop: onePoleCoeff(1200),
      dropDecay: Math.exp(-1 / (0.004 * sampleRate)),
      dropRate: 28 / sampleRate,
    };
  }
  if (type === 'ocean') {
    return {
      pink: new Float64Array(7), lp: 0, aLp: onePoleCoeff(1500),
      ph1: off, ph2: off * 1.3,
      w1: (TWO_PI * 0.07) / sampleRate, w2: (TWO_PI * 0.11) / sampleRate,
    };
  }
  if (type === 'wind') {
    return {
      low: 0, band: 0,
      phA: off, phB: off * 0.7, phC: off * 0.4,
      wA: (TWO_PI * 0.05) / sampleRate,
      wB: (TWO_PI * 0.013) / sampleRate,
      wC: (TWO_PI * 0.03) / sampleRate,
    };
  }
  // space
  return {
    brown: 0, lp: 0, aLp: onePoleCoeff(250),
    ph: off, w: (TWO_PI * 0.017) / sampleRate,
  };
}

function render(type, s, out) {
  if (type === 'rain') {
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      // Hiss bed: white band-limited to roughly 2–8 kHz (highpass then lowpass).
      s.hp = s.aHp * s.hp + (1 - s.aHp) * white;
      const high = white - s.hp;
      s.lpHiss = s.aHiss * s.lpHiss + (1 - s.aHiss) * high;
      // Droplets: sparse random impulses with a fast decay, softened by a lowpass.
      if (Math.random() < s.dropRate) s.dropEnv = 0.4 + Math.random() * 0.6;
      s.dropEnv *= s.dropDecay;
      const excite = s.dropEnv * (Math.random() * 2 - 1);
      s.lpDrop = s.aDrop * s.lpDrop + (1 - s.aDrop) * excite;
      out[i] = s.lpHiss * 1.1 + s.lpDrop * 2.4;
    }
  } else if (type === 'ocean') {
    const pink = s.pink;
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      pink[0] = 0.99886 * pink[0] + white * 0.0555179;
      pink[1] = 0.99332 * pink[1] + white * 0.0750759;
      pink[2] = 0.969 * pink[2] + white * 0.153852;
      pink[3] = 0.8665 * pink[3] + white * 0.3104856;
      pink[4] = 0.55 * pink[4] + white * 0.5329522;
      pink[5] = -0.7616 * pink[5] - white * 0.016898;
      const p =
        (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] +
          pink[6] + white * 0.5362) * 0.11;
      pink[6] = white * 0.115926;
      s.lp = s.aLp * s.lp + (1 - s.aLp) * p;
      // Two incommensurate slow swells so waves never loop audibly.
      s.ph1 += s.w1;
      s.ph2 += s.w2;
      const swell = 0.55 + 0.27 * Math.sin(s.ph1) + 0.18 * Math.sin(s.ph2);
      out[i] = s.lp * swell * 2.2;
    }
  } else if (type === 'wind') {
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      s.phA += s.wA;
      s.phB += s.wB;
      s.phC += s.wC;
      // Band center wanders 250–900 Hz — the "whistling around things" motion.
      const center = 520 + 250 * Math.sin(s.phA) + 130 * Math.sin(s.phB);
      const f = 2 * Math.sin((Math.PI * center) / sampleRate);
      s.low += f * s.band;
      const high = white - s.low - 0.8 * s.band;
      s.band += f * high;
      const gust = 0.55 + 0.45 * Math.sin(s.phC);
      out[i] = s.band * gust * 0.9;
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      s.brown = (s.brown + 0.02 * white) / 1.02;
      s.lp = s.aLp * s.lp + (1 - s.aLp) * s.brown * 3.5;
      s.ph += s.w;
      out[i] = s.lp * (0.75 + 0.25 * Math.sin(s.ph)) * 1.6;
    }
  }
}

class AmbienceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.type = 'rain';
    this.prevType = null;
    this.fade = 1; // 0 → 1 progress of the crossfade into this.type
    this.states = new Map(); // "type:channel" → generator state
    this.scratch = new Float32Array(128);
    this.port.onmessage = (event) => {
      const t = event.data && event.data.type;
      if (TYPES.indexOf(t) !== -1 && t !== this.type) {
        this.prevType = this.type;
        this.type = t;
        this.fade = 0;
      }
    };
  }

  state(type, ch) {
    const key = type + ':' + ch;
    let s = this.states.get(key);
    if (!s) {
      s = makeState(type, ch);
      this.states.set(key, s);
    }
    return s;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const len = output[0] ? output[0].length : 128;
    const fading = this.prevType !== null && this.fade < 1;
    const fadeStep = 1 / (FADE_SECONDS * sampleRate);
    if (this.scratch.length < len) this.scratch = new Float32Array(len);

    for (let ch = 0; ch < output.length; ch++) {
      const samples = output[ch];
      render(this.type, this.state(this.type, ch % 2), samples);
      if (fading) {
        const prev = this.scratch;
        render(this.prevType, this.state(this.prevType, ch % 2), prev);
        for (let i = 0; i < samples.length; i++) {
          const f = Math.min(1, this.fade + fadeStep * (i + 1));
          samples[i] = samples[i] * Math.sqrt(f) + prev[i] * Math.sqrt(1 - f);
        }
      }
    }

    if (fading) {
      this.fade = Math.min(1, this.fade + fadeStep * len);
      if (this.fade >= 1) {
        // Drop the old generator's state so a later switch back restarts clean.
        for (let ch = 0; ch < 2; ch++) this.states.delete(this.prevType + ':' + ch);
        this.prevType = null;
      }
    }
    return true;
  }
}
registerProcessor('${AMBIENCE_PROCESSOR_NAME}', AmbienceProcessor);
`;

const loadedContexts = new WeakSet<BaseAudioContext>();

export async function loadAmbienceWorklet(ctx: AudioContext): Promise<void> {
  if (loadedContexts.has(ctx)) return;
  const blob = new Blob([processorSource], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
    loadedContexts.add(ctx);
  } finally {
    URL.revokeObjectURL(url);
  }
}
