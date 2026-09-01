import { useState } from 'react';
import { useDialog } from './useDialog';

export const TOUR_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Pick how you want to feel',
    body: 'Focus, sleep, calm, energy… every sound is generated live for that state — nothing is pre-recorded, so no two sessions need to be the same.',
  },
  {
    title: 'Set the depth and the length',
    body: 'The depth slider shapes the sound from gentle to deep. Then choose minutes, an end time, or just play until you stop.',
  },
  {
    title: 'Press Begin — headphones help',
    body: 'Binaural beats need stereo. On a speaker, switch to mono mode and they become soft pulses. Keep the volume low and comfortable.',
  },
  {
    title: 'Rate it afterwards',
    body: 'Resonance learns which variation works for you and adjusts the next session. After a few sessions, “Your sound profile” shows what it found.',
  },
];

/**
 * First-run tour: four short cards after the safety disclaimer. Skip and Done
 * both mark it seen — it never shows twice.
 */
export function OnboardingTour(props: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const dialogRef = useDialog<HTMLDivElement>({ onClose: props.onDone });
  const last = step === TOUR_STEPS.length - 1;
  const current = TOUR_STEPS[step];
  return (
    <div className="modal-backdrop">
      <div
        className="modal tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <p className="hint tour-progress" aria-live="polite">
          {step + 1} of {TOUR_STEPS.length}
        </p>
        <h2 id="tour-title">{current.title}</h2>
        <p className="tour-body">{current.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={`tour-dot${i === step ? ' active' : ''}`} />
          ))}
        </div>
        <div className="transport tour-actions">
          {step > 0 && (
            <button type="button" className="chip" onClick={() => setStep(step - 1)}>
              ← Back
            </button>
          )}
          <button
            type="button"
            className="play-button"
            onClick={() => (last ? props.onDone() : setStep(step + 1))}
          >
            {last ? 'Done' : 'Next →'}
          </button>
          {!last && (
            <button type="button" className="link-button" onClick={props.onDone}>
              Skip tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
