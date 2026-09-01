import { useState } from 'react';
import type { Distraction, FeedbackInput, Rating } from '../storage/types';
import { PresetSaveRow } from './PresetSaveRow';
import { useRadioGroup } from './useRadioGroup';

const RATINGS: Rating[] = [1, 2, 3, 4, 5];
const DISTRACTIONS: readonly Distraction[] = [1, 2, 3];
const DISTRACTION_LABELS: Record<Distraction, string> = {
  1: 'Not at all',
  2: 'A little',
  3: 'Very',
};
const USE_AGAIN: readonly boolean[] = [true, false];

/**
 * Post-session feedback (PRD §15.6, §9). The 1–5 rating is the submit — one
 * tap, as always. The two PRD §9 extras above it are optional chips that
 * travel with the rating when set; they never add a step.
 */
export function FeedbackScreen(props: {
  stateLabel: string;
  completed: boolean;
  onRate: (input: FeedbackInput) => void;
  onSkip: () => void;
  onSavePreset: (name: string) => void;
}) {
  const [distraction, setDistraction] = useState<Distraction | null>(null);
  const [useAgain, setUseAgain] = useState<boolean | null>(null);
  const distractionGroup = useRadioGroup<Distraction>({
    items: DISTRACTIONS,
    value: distraction,
    onChange: setDistraction,
    getKey: (d) => String(d),
  });
  const useAgainGroup = useRadioGroup<boolean>({
    items: USE_AGAIN,
    value: useAgain,
    onChange: setUseAgain,
    getKey: (v) => (v ? 'yes' : 'no'),
  });

  const submit = (rating: Rating) => {
    props.onRate({
      rating,
      ...(distraction !== null ? { distraction } : {}),
      ...(useAgain !== null ? { useAgain } : {}),
    });
  };

  return (
    <div className="feedback">
      <h2>{props.completed ? 'Session complete' : 'Session stopped'}</h2>

      <div className="feedback-extra">
        <span className="setup-question" id="distraction-label">
          Was the sound distracting?
        </span>
        <div className="preset-strip" {...distractionGroup.groupProps} aria-labelledby="distraction-label">
          {DISTRACTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${distraction === d ? ' selected' : ''}`}
              {...distractionGroup.itemProps(d)}
              onClick={() => setDistraction(distraction === d ? null : d)}
            >
              {DISTRACTION_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="feedback-extra">
        <span className="setup-question" id="use-again-label">
          Would you use this sound again?
        </span>
        <div className="preset-strip" {...useAgainGroup.groupProps} aria-labelledby="use-again-label">
          {USE_AGAIN.map((v) => (
            <button
              key={String(v)}
              type="button"
              className={`chip${useAgain === v ? ' selected' : ''}`}
              {...useAgainGroup.itemProps(v)}
              onClick={() => setUseAgain(useAgain === v ? null : v)}
            >
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>

      <p className="setup-question">How effective was this?</p>
      <div className="rating-row">
        <span className="rating-anchor">😫</span>
        {RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            className="rating-button"
            onClick={() => submit(r)}
          >
            {r}
          </button>
        ))}
        <span className="rating-anchor">😍</span>
      </div>

      <PresetSaveRow
        defaultName={`${props.stateLabel} session`}
        onSave={props.onSavePreset}
      />

      <button type="button" className="advanced-toggle skip-button" onClick={props.onSkip}>
        Skip
      </button>
    </div>
  );
}
