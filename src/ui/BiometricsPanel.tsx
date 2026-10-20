import type { BiometricStatus } from '../biometrics/types';

export const STATUS_LABEL: Record<BiometricStatus, string> = {
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
    </section>
  );
}

const MOTION_STATUS_LABEL: Record<BiometricStatus, string> = {
  ...STATUS_LABEL,
  unavailable: 'No motion sensor found on this device',
  disconnected: 'Starts with your next session',
  connecting: 'Starting…',
  connected: 'Sensing',
  error: 'Motion access was refused — allow it in the browser settings',
};

/**
 * Phone-on-the-mattress opt-in (Phase 16, PRD §17 "movement"; consent per
 * §14). Once agreed, sensing starts with each Begin — that tap is the
 * gesture iOS needs for its one-time permission prompt. "Test" starts it
 * right away to check the sensor.
 */
export function MotionPanel(props: {
  status: BiometricStatus;
  consented: boolean;
  simulated: boolean;
  onConsent: (consented: boolean) => void;
  onStart: () => void;
}) {
  return (
    <section className="setup-section biometrics-panel">
      <h2 className="setup-question">Phone on the mattress (optional)</h2>
      <p className="hint">
        Lay the phone on the bed near you: its motion sensor notices tossing and turning, so
        sleep and calm sessions can soften when you're restless — no wearable needed. Leave the
        screen on (the app keeps it awake); locking the phone pauses sensing. Movement is read
        live on this device only — each session keeps just a summary.
      </p>
      <label className="mono-toggle">
        <input
          type="checkbox"
          checked={props.consented}
          onChange={(e) => props.onConsent(e.target.checked)}
        />
        I agree to Resonance reading this phone's motion sensor while a session runs
      </label>
      <div className="biometrics-row">
        {props.status !== 'connected' && (
          <button
            type="button"
            className="chip"
            disabled={!props.consented || props.status === 'connecting'}
            onClick={props.onStart}
          >
            {props.simulated ? 'Test simulated sensor' : 'Test the sensor'}
          </button>
        )}
        <span className="hint">{MOTION_STATUS_LABEL[props.status]}</span>
      </div>
    </section>
  );
}

/** Phase 9 / 16: the sleep-onset fade, offered once any sensor is agreed to. */
export function SleepOnsetToggle(props: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <section className="setup-section biometrics-panel">
      <label className="mono-toggle">
        <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
        Fade sleep sessions out once I'm asleep (heart rate or phone motion)
      </label>
    </section>
  );
}
