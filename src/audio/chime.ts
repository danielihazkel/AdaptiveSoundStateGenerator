/**
 * Gentle end-of-session chime (PRD §4 step 4). Two soft sine partials with a
 * fast attack and a long exponential decay. Connect to the limiter input, not
 * the master gain — the master has already faded to 0 when this plays.
 */
export function playChime(ctx: BaseAudioContext, destination: AudioNode): void {
  const now = ctx.currentTime;
  const duration = 1.8;
  const envelope = new GainNode(ctx, { gain: 0 });
  envelope.connect(destination);
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.12, now + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  const partials: Array<[number, number]> = [
    [880, 1],
    [1320, 0.3],
  ];
  for (const [frequency, level] of partials) {
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency });
    const oscGain = new GainNode(ctx, { gain: level });
    osc.connect(oscGain).connect(envelope);
    osc.start(now);
    osc.stop(now + duration + 0.1);
    osc.onended = () => {
      osc.disconnect();
      oscGain.disconnect();
      envelope.disconnect();
    };
  }
}
