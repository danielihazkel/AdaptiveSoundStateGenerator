import type { CheckpointResponse } from '../adaptation/types';

/**
 * Mid-session one-tap check-in (Phase 3, PRD §17). Deliberately subtle: three
 * chips and a dismiss, no rating scale — anything heavier would defeat the
 * state the session is trying to build. Auto-dismissed by App after
 * PROMPT_TIMEOUT_SEC; dismissal is neutral, never a negative signal.
 */
export function MicroPrompt(props: {
  onRespond: (response: CheckpointResponse) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="notice micro-prompt">
      <span>How's it feeling?</span>
      <div className="micro-prompt-actions">
        <button type="button" className="chip" onClick={() => props.onRespond('better')}>
          Better
        </button>
        <button type="button" className="chip" onClick={() => props.onRespond('same')}>
          Same
        </button>
        <button type="button" className="chip" onClick={() => props.onRespond('worse')}>
          Worse
        </button>
        <button
          type="button"
          className="chip"
          aria-label="Dismiss"
          onClick={props.onDismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
