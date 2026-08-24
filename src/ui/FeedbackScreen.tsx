import type { Rating } from '../storage/types';
import { PresetSaveRow } from './PresetSaveRow';

const RATINGS: Rating[] = [1, 2, 3, 4, 5];

/** Post-session 1–5 feedback (PRD §15.6, §9) — one scale everywhere. */
export function FeedbackScreen(props: {
  stateLabel: string;
  completed: boolean;
  onRate: (rating: Rating) => void;
  onSkip: () => void;
  onSavePreset: (name: string) => void;
}) {
  return (
    <div className="feedback">
      <h2>{props.completed ? 'Session complete' : 'Session stopped'}</h2>
      <p className="setup-question">How effective was this?</p>
      <div className="rating-row">
        <span className="rating-anchor">😫</span>
        {RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            className="rating-button"
            onClick={() => props.onRate(r)}
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
