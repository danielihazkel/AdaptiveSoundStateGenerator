import { useDialog } from './useDialog';

/** Safety surfaces required by PRD §13 and §7. */

/** Shown when the audio engine fails to start (blocked autoplay, worklet, no device). */
export const START_ERROR_MESSAGE =
  "Couldn't start audio. Check that sound isn't blocked for this site and try again.";

export function DisclaimerModal(props: { onAcknowledge: () => void }) {
  // Not dismissible — acknowledging is the only way out, so no Escape handler.
  const dialogRef = useDialog<HTMLDivElement>();
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2 id="disclaimer-title">Before you listen</h2>
        <ul className="disclaimer-list">
          <li>
            Resonance is <strong>not a medical device</strong> and does not diagnose or
            treat any condition. These soundscapes are designed to support focus,
            relaxation, or other desired states — individual responses vary.
          </li>
          <li>
            Keep the volume at a comfortable, low level. Extended listening at high
            volume can damage hearing.
          </li>
          <li>If you have tinnitus or find stereo beat effects uncomfortable, start
            quietly or disable the binaural layer in the advanced panel.</li>
          <li>Do not use sleep or relaxation sessions while driving or operating
            machinery.</li>
        </ul>
        <button type="button" className="play-button" onClick={props.onAcknowledge}>
          I understand
        </button>
      </div>
    </div>
  );
}

export function HeadphoneHint(props: {
  monoMode: boolean;
  onToggleMono: (mono: boolean) => void;
}) {
  return (
    <div className="notice">
      <span>
        {props.monoMode
          ? '🔈 Speaker mode: binaural beats are replaced with gentle pulses.'
          : '🎧 Binaural beats need headphones for true stereo separation.'}
      </span>
      <label className="mono-toggle">
        <input
          type="checkbox"
          checked={props.monoMode}
          onChange={(e) => props.onToggleMono(e.target.checked)}
        />
        Speaker / mono mode
      </label>
    </div>
  );
}

export function NoDrivingWarning() {
  return <p className="notice warning">🚗 Do not use this session while driving.</p>;
}

export function FooterDisclaimer() {
  return (
    <p className="footer-disclaimer">
      Not a medical device. Individual responses vary. Listen at a safe volume.
    </p>
  );
}
