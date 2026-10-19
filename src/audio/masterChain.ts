/**
 * The engine's output chain, built back to front:
 *
 *   preMaster → master → loudnessTrim → lowpass → bassShelf → limiter → monoGate → destination
 *
 * - preMaster: the pulsed tonal mix lands here; the reverb send taps it, so
 *   the wet signal rides master fades, the filters, the limiter and the mono
 *   gate — while ambience (already diffuse) and the chime stay dry.
 * - master: volume and every session fade.
 * - loudnessTrim: a fixed per-profile level correction (arm loudness
 *   matching). It sits after master so fades never touch it, and before the
 *   limiter so a boost stays under the PRD §13 ceiling. Gain 1 = inert.
 * - bassShelf: after master (session fades scale it), before the limiter.
 * - limiter: hard safety net, not an effect (PRD §13 loudness ceiling).
 * - monoGate: channelCount 2 → 1 is the mono/speaker fallback.
 */
export interface MasterChain {
  preMaster: GainNode;
  master: GainNode;
  loudnessTrim: GainNode;
  lowpass: BiquadFilterNode;
  bassShelf: BiquadFilterNode;
  limiter: DynamicsCompressorNode;
  monoGate: GainNode;
}

export function buildMasterChain(ctx: BaseAudioContext, lowpassHz: number): MasterChain {
  const monoGate = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit' });
  monoGate.connect(ctx.destination);
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -10,
    knee: 0,
    ratio: 20,
    attack: 0.003,
    release: 0.25,
  });
  limiter.connect(monoGate);
  const bassShelf = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 150, gain: 0 });
  bassShelf.connect(limiter);
  const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: lowpassHz, Q: 0.0001 });
  lowpass.connect(bassShelf);
  const loudnessTrim = new GainNode(ctx, { gain: 1 });
  loudnessTrim.connect(lowpass);
  const master = new GainNode(ctx, { gain: 0 });
  master.connect(loudnessTrim);
  const preMaster = new GainNode(ctx);
  preMaster.connect(master);
  return { preMaster, master, loudnessTrim, lowpass, bassShelf, limiter, monoGate };
}

export function disposeMasterChain(chain: MasterChain): void {
  for (const node of Object.values(chain)) node.disconnect();
}
