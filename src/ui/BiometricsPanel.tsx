import type { BiometricStatus } from '../biometrics/types';

const STATUS_LABEL: Record<BiometricStatus, string> = {
  unavailable: 'Not supported in this browser',
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection error',
};

/**
 * Wearable opt-in (Phase 3, PRD §17; consent per PRD §14). Rendered only when
 * a source is possible (Web Bluetooth available, or the ?simhr dev source).
 * Connect must stay a plain button click — requestDevice needs a user gesture.
 */
export function BiometricsPanel(props: {
  status: BiometricStatus;
  consented: boolean;
  simulated: boolean;
  onConsent: (consented: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Phase 9: fade sleep sessions out once the heart rate says "asleep". */
  sleepOnsetFade: boolean;
  onSleepOnsetFadeChange: (on: boolean) => void;
}) {
  return (
    <section className="setup-section biometrics-panel">
      <h2 className="setup-question">Heart rate (optional)</h2>
      <p className="hint">
        With a Bluetooth heart-rate sensor, sessions can adapt to how your body
        responds. Readings are used live on this device only and never stored —
        each session keeps just a summary trend.
      </p>
      <label className="mono-toggle">
        <input
          type="checkbox"
          checked={props.consented}
          onChange={(e) => props.onConsent(e.target.checked)}
        />
        I agree to Resonance reading my heart rate while a session runs
      </label>
      <div className="biometrics-row">
        {props.status === 'connected' ? (
          <button type="button" className="chip" onClick={props.onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="chip"
            disabled={!props.consented || props.status === 'connecting'}
            onClick={props.onConnect}
          >
            {props.simulated ? 'Connect simulated sensor' : 'Connect sensor'}
          </button>
        )}
        <span className="hint">{STATUS_LABEL[props.status]}</span>
      </div>
      {props.consented && (
        <label className="mono-toggle">
          <input
            type="checkbox"
            checked={props.sleepOnsetFade}
            onChange={(e) => props.onSleepOnsetFadeChange(e.target.checked)}
          />
          Fade out once I'm asleep (sleep sessions with the sensor connected)
        </label>
      )}
    </section>
  );
}
