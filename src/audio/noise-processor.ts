/**
 * AudioWorklet noise generator (PRD §6D, §7).
 *
 * The processor source is shipped as a string and loaded through a Blob URL so
 * it survives both the Vite dev server and the production build without any
 * bundler-specific worklet handling. It runs in the AudioWorkletGlobalScope,
 * so it must stay self-contained plain JavaScript.
 *
 * Output is stereo with independently generated channels (decorrelated noise
 * sounds wider than mono copied to both ears). Pink noise uses Paul Kellett's
 * refined filter; brown noise is a leaky integrator over white noise; blue
 * noise is differentiated white noise (first difference).
 *
 * Colour switches crossfade equal-power inside the processor: 100 ms by
 * default (a slider tap stays click-free) or as long as the `fadeSeconds`
 * message field asks — a timed program moving pink → brown between phases
 * glides over several seconds instead of stepping.
 */
export const NOISE_PROCESSOR_NAME = 'resonance-noise';

/** Default colour crossfade; message `fadeSeconds` overrides per switch. */
export const NOISE_DEFAULT_FADE_SECONDS = 0.1;

/** Exported for tests only — evaluated under Node with worklet globals stubbed. */
export const processorSource = /* js */ `
const TYPES = ['white', 'pink', 'brown', 'blue'];
const DEFAULT_FADE_SECONDS = ${NOISE_DEFAULT_FADE_SECONDS};

function makeState(type) {
  if (type === 'pink') return { pink: new Float64Array(7) };
  if (type === 'brown') return { last: 0 };
  if (type === 'blue') return { last: 0 };
  return {};
}

function render(type, s, out) {
  if (type === 'white') {
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.random() * 2 - 1;
    }
  } else if (type === 'pink') {
    const pink = s.pink;
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      pink[0] = 0.99886 * pink[0] + white * 0.0555179;
      pink[1] = 0.99332 * pink[1] + white * 0.0750759;
      pink[2] = 0.969 * pink[2] + white * 0.153852;
      pink[3] = 0.8665 * pink[3] + white * 0.3104856;
      pink[4] = 0.55 * pink[4] + white * 0.5329522;
      pink[5] = -0.7616 * pink[5] - white * 0.016898;
      out[i] =
        (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] +
          pink[6] + white * 0.5362) * 0.11;
      pink[6] = white * 0.115926;
    }
  } else if (type === 'blue') {
    let last = s.last;
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      out[i] = (white - last) * 0.4;
      last = white;
    }
    s.last = last;
  } else {
    let last = s.last;
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      out[i] = last * 3.5;
    }
    s.last = last;
  }
}

class NoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.type = 'white';
    this.prevType = null;
    this.fade = 1; // 0 → 1 progress of the crossfade into this.type
    this.fadeSeconds = DEFAULT_FADE_SECONDS;
    this.states = new Map(); // "type:channel" → generator state
    this.scratch = new Float32Array(128);
    this.port.onmessage = (event) => {
      const data = event.data || {};
      const t = data.type;
      if (TYPES.indexOf(t) === -1 || t === this.type) return;
      this.prevType = this.type;
      this.type = t;
      this.fade = 0;
      const f = data.fadeSeconds;
      this.fadeSeconds =
        typeof f === 'number' && isFinite(f) && f > 0 ? f : DEFAULT_FADE_SECONDS;
    };
  }

  state(type, ch) {
    const key = type + ':' + ch;
    let s = this.states.get(key);
    if (!s) {
      s = makeState(type);
      this.states.set(key, s);
    }
    return s;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const len = output[0] ? output[0].length : 128;
    const fading = this.prevType !== null && this.fade < 1;
    const fadeStep = 1 / (this.fadeSeconds * sampleRate);
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
        for (let ch = 0; ch < 2; ch++) this.states.delete(this.prevType + ':' + ch);
        this.prevType = null;
      }
    }
    return true;
  }
}
registerProcessor('${NOISE_PROCESSOR_NAME}', NoiseProcessor);
`;

const loadedContexts = new WeakSet<BaseAudioContext>();

export async function loadNoiseWorklet(ctx: BaseAudioContext): Promise<void> {
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
