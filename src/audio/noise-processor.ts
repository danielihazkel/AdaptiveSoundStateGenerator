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
 */
export const NOISE_PROCESSOR_NAME = 'resonance-noise';

const processorSource = /* js */ `
class NoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.type = 'white';
    // Per-channel filter state: pink (b0..b6) and brown (last sample).
    this.pink = [new Float64Array(7), new Float64Array(7)];
    this.brown = [0, 0];
    this.blue = [0, 0];
    this.port.onmessage = (event) => {
      const t = event.data && event.data.type;
      if (t === 'white' || t === 'pink' || t === 'brown' || t === 'blue') this.type = t;
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    for (let ch = 0; ch < output.length; ch++) {
      const samples = output[ch];
      const pink = this.pink[ch % 2];
      if (this.type === 'white') {
        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.random() * 2 - 1;
        }
      } else if (this.type === 'pink') {
        for (let i = 0; i < samples.length; i++) {
          const white = Math.random() * 2 - 1;
          pink[0] = 0.99886 * pink[0] + white * 0.0555179;
          pink[1] = 0.99332 * pink[1] + white * 0.0750759;
          pink[2] = 0.969 * pink[2] + white * 0.153852;
          pink[3] = 0.8665 * pink[3] + white * 0.3104856;
          pink[4] = 0.55 * pink[4] + white * 0.5329522;
          pink[5] = -0.7616 * pink[5] - white * 0.016898;
          samples[i] =
            (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] +
              pink[6] + white * 0.5362) * 0.11;
          pink[6] = white * 0.115926;
        }
      } else if (this.type === 'blue') {
        let last = this.blue[ch % 2];
        for (let i = 0; i < samples.length; i++) {
          const white = Math.random() * 2 - 1;
          samples[i] = (white - last) * 0.4;
          last = white;
        }
        this.blue[ch % 2] = last;
      } else {
        let last = this.brown[ch % 2];
        for (let i = 0; i < samples.length; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          samples[i] = last * 3.5;
        }
        this.brown[ch % 2] = last;
      }
    }
    return true;
  }
}
registerProcessor('${NOISE_PROCESSOR_NAME}', NoiseProcessor);
`;

const loadedContexts = new WeakSet<BaseAudioContext>();

export async function loadNoiseWorklet(ctx: AudioContext): Promise<void> {
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
