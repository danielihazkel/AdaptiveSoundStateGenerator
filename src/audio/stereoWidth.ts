import { ramp } from './ramp';

/**
 * Stereo width control (PRD §5) as a 2×2 gain matrix:
 *
 *   out_L = gSame·L + gCross·R      gSame  = (1 + w) / 2
 *   out_R = gCross·L + gSame·R      gCross = (1 - w) / 2
 *
 * w = 1 is passthrough, w = 0 a full mono sum. The binaural layer must NOT
 * route through this node — narrowing it would silently turn binaural beats
 * into ordinary amplitude beating.
 */
export class StereoWidthNode {
  readonly input: GainNode;
  private readonly sameL: GainNode;
  private readonly sameR: GainNode;
  private readonly crossLR: GainNode;
  private readonly crossRL: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    width: number,
  ) {
    const gSame = (1 + width) / 2;
    const gCross = (1 - width) / 2;
    this.input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit' });
    this.splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.sameL = new GainNode(ctx, { gain: gSame });
    this.sameR = new GainNode(ctx, { gain: gSame });
    this.crossLR = new GainNode(ctx, { gain: gCross });
    this.crossRL = new GainNode(ctx, { gain: gCross });

    this.input.connect(this.splitter);
    this.splitter.connect(this.sameL, 0);
    this.splitter.connect(this.crossLR, 0);
    this.splitter.connect(this.sameR, 1);
    this.splitter.connect(this.crossRL, 1);
    this.sameL.connect(this.merger, 0, 0);
    this.crossRL.connect(this.merger, 0, 0);
    this.sameR.connect(this.merger, 0, 1);
    this.crossLR.connect(this.merger, 0, 1);
    this.merger.connect(destination);
  }

  setWidth(width: number, timeConstant?: number): void {
    const gSame = (1 + width) / 2;
    const gCross = (1 - width) / 2;
    ramp(this.ctx, this.sameL.gain, gSame, timeConstant);
    ramp(this.ctx, this.sameR.gain, gSame, timeConstant);
    ramp(this.ctx, this.crossLR.gain, gCross, timeConstant);
    ramp(this.ctx, this.crossRL.gain, gCross, timeConstant);
  }

  dispose(): void {
    this.input.disconnect();
    this.splitter.disconnect();
    this.sameL.disconnect();
    this.sameR.disconnect();
    this.crossLR.disconnect();
    this.crossRL.disconnect();
    this.merger.disconnect();
  }
}
