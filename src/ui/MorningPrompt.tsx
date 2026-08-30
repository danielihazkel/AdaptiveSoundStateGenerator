import type { Rating } from '../storage/types';
import { useDialog } from './useDialog';

const RATINGS: Rating[] = [1, 2, 3, 4, 5];

/**
 * Next-morning rating for a completed sleep session (PRD §9) — shown as a
 * modal on app open, since the user was asleep when the session ended.
 */
export function MorningPromptModal(props: {
  onRate: (rating: Rating) => void;
  onDismiss: () => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>({ onClose: props.onDismiss });
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="morning-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2 id="morning-title">Good morning</h2>
        <p className="setup-question">
          How did you sleep after last night's session?
        </p>
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
        <button
          type="button"
          className="advanced-toggle skip-button"
          onClick={props.onDismiss}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
