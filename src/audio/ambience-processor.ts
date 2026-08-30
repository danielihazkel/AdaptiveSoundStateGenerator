/**
 * AudioWorklet synthesized-ambience generator (PRD §6E).
 *
 * Every ambience type is synthesized from shaped noise plus a few sparse
 * events — no audio files, so all seven work fully offline. Rain, ocean,
 * wind and space are pure textures; forest, fireplace and café add event
 * schedulers (bird calls, crackles, clinks) on top of a bed. Like the noise
 * processor, the source ships as a string loaded through a Blob URL (survives
 * Vite dev + build with no bundler worklet handling) and must stay
 * self-contained plain JavaScript.
 *
 * The swell/gust modulators and event schedulers live inside the processor as
 * per-sample phase accumulators / sample counters: sample-accurate and immune
 * to background-tab timer throttling. Channels keep independent generator
 * state (decorrelated = wide), with slow-LFO phases offset per channel and
 * event schedulers seeded independently, so a bird or a clink lands on one
 * side. Type switches crossfade equal-power over ~100 ms inside the
 * processor, so setType is click-free.
 */
export const AMBIENCE_PROCESSOR_NAME = 'resonance-ambience';

/** Types the processor can render — must cover every AmbienceType. */
export const AMBIENCE_PROCESSOR_TYPES = [
  'rain',
  'ocean',
  'wind',
  'space',
  'forest',
  'fireplace',
  'cafe',
] as const;

/** Exported for tests only — evaluated under Node with worklet globals stubbed. */
export const processorSource = /* js */ `
const TYPES = ${JSON.stringify(AMBIENCE_PROCESSOR_TYPES)};
const FADE_SECONDS = 0.1;
const TWO_PI = Math.PI * 2;

function onePoleCoeff(cutoffHz) {
  return Math.exp((-TWO_PI * cutoffHz) / sampleRate);
}

/** State-variable filter coefficient for a center frequency. */
function svfCoeff(hz) {
  return 2 * Math.sin((Math.PI * hz) / sampleRate);
}

/** Per-sample decay multiplier for an exponential envelope of ~tau seconds. */
function decay(tauSec) {
  return Math.exp(-1 / (tauSec * sampleRate));
}

function makePink() {
  return new Float64Array(7);
}

/** Paul Kellet's pink filter; one step, returns the pink sample. */
function pinkStep(pink, white) {
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
  return p;
}

function makeState(type, ch) {
  // Per-channel LFO phases start offset so left/right breathe out of step.
  const off = ch * 2.1;
  if (type === 'rain') {
    return {
      hp: 0, lpHiss: 0, lpDrop: 0, dropEnv: 0,
      aHp: onePoleCoeff(2000), aHiss: onePoleCoeff(8000), aDrop: onePoleCoeff(1200),
      dropDecay: decay(0.004),
      dropRate: 28 / sampleRate,
    };
  }
  if (type === 'ocean') {
    return {
      pink: makePink(), lp: 0, aLp: onePoleCoeff(1500),
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
  if (type === 'forest') {
    return {
      // Leaves: pink noise high-passed, breathing with two slow gusts.
      pink: makePink(), hp: 0, aHp: onePoleCoeff(1200),
      phG1: off, phG2: off * 0.6,
      wG1: (TWO_PI * 0.05) / sampleRate, wG2: (TWO_PI * 0.013) / sampleRate,
      // Bird scheduler: wait → motif of 2–4 notes, each a glided sine with a
      // raised-cosine envelope. Seeded per channel so calls come from either side.
      wait: Math.floor((0.5 + 3 * Math.random() + ch * 1.5) * sampleRate),
      notesLeft: 0, gap: 0, noteLen: 0, notePos: 0, f0: 0, f1: 0, amp: 0, phase: 0,
    };
  }
  if (type === 'fireplace') {
    return {
      // Bed: brown noise low-passed with a slow two-sine flicker.
      brown: 0, lp: 0, aLp: onePoleCoeff(350),
      phF1: off, phF2: off * 1.7,
      wF1: (TWO_PI * 0.3) / sampleRate, wF2: (TWO_PI * 0.47) / sampleRate,
      // Crackles: sparse impulses → resonant band-pass ~2.5 kHz.
      crackleRate: 12 / sampleRate, crackleEnv: 0, crackleDecay: 1,
      cLow: 0, cBand: 0, cF: svfCoeff(2500),
      // Pops: rarer, larger, lower (~600 Hz), longer decay.
      popRate: 0.4 / sampleRate, popEnv: 0, popDecay: decay(0.02),
      pLow: 0, pBand: 0, pF: svfCoeff(600),
    };
  }
  if (type === 'cafe') {
    return {
      // Murmur: pink noise through a wandering band-pass, "babbling" amplitude.
      pink: makePink(), mLow: 0, mBand: 0,
      phM1: off, phM2: off * 0.8, phM3: off * 1.4,
      wM1: (TWO_PI * 0.031) / sampleRate,
      wM2: (TWO_PI * 0.017) / sampleRate,
      wM3: (TWO_PI * 0.053) / sampleRate,
      phB1: off * 3, phB2: off * 5, phB3: off * 7,
      wB1: (TWO_PI * 1.7) / sampleRate,
      wB2: (TWO_PI * 2.9) / sampleRate,
      wB3: (TWO_PI * 3.7) / sampleRate,
      // Clinks: impulse burst → high-Q resonator (3–5 kHz), ~150 ms ring; an
      // optional quieter "dish" echo 30 ms later.
      wait: Math.floor((1 + 4 * Math.random() + ch * 2) * sampleRate),
      burst: 0, burstDecay: decay(0.001), ringEnv: 0, ringDecay: decay(0.15),
      rLow: 0, rBand: 0, rF: svfCoeff(4000), clinkAmp: 0,
      dishWait: 0, dishAmp: 0,
    };
  }
  // space
  return {
    brown: 0, lp: 0, aLp: onePoleCoeff(250),
    ph: off, w: (TWO_PI * 0.017) / sampleRate,
  };
}

function startBirdNote(s) {
  s.notesLeft -= 1;
  s.f0 = 2200 + 2300 * Math.random();
  s.f1 = s.f0 * (1 + (Math.random() * 0.3 - 0.15));
  s.noteLen = Math.floor((0.06 + 0.12 * Math.random()) * sampleRate);
  s.notePos = 0;
  s.amp = 0.28 + 0.14 * Math.random();
}

/** One sample of the forest bird scheduler. */
function birdSample(s) {
  if (s.noteLen > 0) {
    const t = s.notePos / s.noteLen;
    const env = 0.5 * (1 - Math.cos(TWO_PI * t));
    const freq = s.f0 + (s.f1 - s.f0) * t;
    s.phase += (TWO_PI * freq) / sampleRate;
    if (s.phase > TWO_PI) s.phase -= TWO_PI;
    const v = Math.sin(s.phase) * env * s.amp;
    s.notePos += 1;
    if (s.notePos >= s.noteLen) {
      s.noteLen = 0;
      if (s.notesLeft > 0) {
        s.gap = Math.floor((0.08 + 0.12 * Math.random()) * sampleRate);
      } else {
        s.wait = Math.floor((1.5 + 5.5 * Math.random()) * sampleRate);
      }
    }
    return v;
  }
  if (s.gap > 0) {
    s.gap -= 1;
    if (s.gap === 0) startBirdNote(s);
    return 0;
  }
  s.wait -= 1;
  if (s.wait <= 0) {
    s.notesLeft = 2 + Math.floor(Math.random() * 3);
    startBirdNote(s);
  }
  return 0;
}

function startClink(s, amp) {
  s.burst = 1;
  s.ringEnv = 1;
  s.clinkAmp = amp;
  s.rF = svfCoeff(3000 + 2000 * Math.random());
}

/** One sample of the café clink scheduler + resonator. */
function clinkSample(s) {
  s.wait -= 1;
  if (s.wait <= 0) {
    startClink(s, 0.5 + 0.5 * Math.random());
    s.wait = Math.floor((2 + 7 * Math.random()) * sampleRate);
    if (Math.random() < 0.5) {
      s.dishWait = Math.floor(0.03 * sampleRate);
      s.dishAmp = s.clinkAmp * 0.5;
    }
  }
  if (s.dishWait > 0) {
    s.dishWait -= 1;
    if (s.dishWait === 0) startClink(s, s.dishAmp);
  }
  // 1 ms noise burst excites a lightly damped resonator; a separate envelope
  // shapes the ring so the decay is fixed regardless of the resonator's Q.
  const excite = s.burst * (Math.random() * 2 - 1);
  s.burst *= s.burstDecay;
  s.rLow += s.rF * s.rBand;
  const high = excite - s.rLow - 0.08 * s.rBand;
  s.rBand += s.rF * high;
  s.ringEnv *= s.ringDecay;
  return s.rBand * s.ringEnv * s.clinkAmp;
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
    for (let i = 0; i < out.length; i++) {
      const p = pinkStep(s.pink, Math.random() * 2 - 1);
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
      const f = svfCoeff(center);
      s.low += f * s.band;
      const high = white - s.low - 0.8 * s.band;
      s.band += f * high;
      const gust = 0.55 + 0.45 * Math.sin(s.phC);
      out[i] = s.band * gust * 0.9;
    }
  } else if (type === 'forest') {
    for (let i = 0; i < out.length; i++) {
      const p = pinkStep(s.pink, Math.random() * 2 - 1);
      // Leaves: only the upper band, breathing with the gusts.
      s.hp = s.aHp * s.hp + (1 - s.aHp) * p;
      const leaves = p - s.hp;
      s.phG1 += s.wG1;
      s.phG2 += s.wG2;
      const gust = 0.5 + 0.3 * Math.sin(s.phG1) + 0.2 * Math.sin(s.phG2);
      out[i] = leaves * gust * 1.2 + birdSample(s);
    }
  } else if (type === 'fireplace') {
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      s.brown = (s.brown + 0.02 * white) / 1.02;
      s.lp = s.aLp * s.lp + (1 - s.aLp) * s.brown * 3.5;
      s.phF1 += s.wF1;
      s.phF2 += s.wF2;
      const flicker = 0.7 + 0.2 * Math.sin(s.phF1) + 0.1 * Math.sin(s.phF2);
      const bed = s.lp * flicker * 1.4;
      // Crackles: each impulse gets its own 2–6 ms decay.
      if (Math.random() < s.crackleRate) {
        s.crackleEnv = 0.3 + 0.7 * Math.random();
        s.crackleDecay = decay(0.002 + 0.004 * Math.random());
      }
      s.crackleEnv *= s.crackleDecay;
      const cEx = s.crackleEnv * (Math.random() * 2 - 1);
      s.cLow += s.cF * s.cBand;
      const cHigh = cEx - s.cLow - 0.5 * s.cBand;
      s.cBand += s.cF * cHigh;
      // Pops.
      if (Math.random() < s.popRate) s.popEnv = 0.6 + 0.4 * Math.random();
      s.popEnv *= s.popDecay;
      const pEx = s.popEnv * (Math.random() * 2 - 1);
      s.pLow += s.pF * s.pBand;
      const pHigh = pEx - s.pLow - 0.6 * s.pBand;
      s.pBand += s.pF * pHigh;
      out[i] = bed + s.cBand * 1.0 + s.pBand * 0.8;
    }
  } else if (type === 'cafe') {
    for (let i = 0; i < out.length; i++) {
      const p = pinkStep(s.pink, Math.random() * 2 - 1);
      s.phM1 += s.wM1;
      s.phM2 += s.wM2;
      s.phM3 += s.wM3;
      // Murmur band wanders 300–900 Hz, like voices drifting in and out.
      const center = 600 + 200 * Math.sin(s.phM1) + 100 * Math.sin(s.phM2);
      const f = svfCoeff(center);
      s.mLow += f * s.mBand;
      const high = p - s.mLow - 0.6 * s.mBand;
      s.mBand += f * high;
      s.phB1 += s.wB1;
      s.phB2 += s.wB2;
      s.phB3 += s.wB3;
      // Syllable-rate babble, never fully silent.
      const b = (Math.sin(s.phB1) + Math.sin(s.phB2) + Math.sin(s.phB3)) / 3;
      const babble = 0.35 + 0.65 * (0.5 + 0.5 * b);
      out[i] = s.mBand * babble * 2.0 + clinkSample(s) * 0.8;
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

export async function loadAmbienceWorklet(ctx: BaseAudioContext): Promise<void> {
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
