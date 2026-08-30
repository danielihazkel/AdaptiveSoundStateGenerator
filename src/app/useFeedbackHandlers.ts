import { resolveOutcome } from '../personalization/personalizer';
import { attachFeedback, markFeedbackSkipped } from '../storage/storage';
import type { Rating, SessionRecord } from '../storage/types';
import type { FinishedSession } from './useSessionOrchestrator';

/**
 * Post-session and next-morning ratings: attach the feedback (or the
 * "declined to rate" signal), settle the bandit outcome, and move on.
 */
export function useFeedbackHandlers(deps: {
  getLastSession: () => FinishedSession | null;
  morningPrompt: SessionRecord | null;
  setMorningPrompt: (record: SessionRecord | null) => void;
  bumpData: () => void;
  onDone: () => void;
}) {
  const settle = (id: string | undefined, apply: (id: string) => void) => {
    if (!id) return;
    apply(id);
    resolveOutcome(id);
    deps.bumpData();
  };

  return {
    rate: (rating: Rating) => {
      settle(deps.getLastSession()?.recordId, (id) => attachFeedback(id, rating));
      deps.onDone();
    },
    skip: () => {
      settle(deps.getLastSession()?.recordId, markFeedbackSkipped);
      deps.onDone();
    },
    morningRate: (rating: Rating) => {
      settle(deps.morningPrompt?.id, (id) => attachFeedback(id, rating));
      deps.setMorningPrompt(null);
    },
    morningDismiss: () => {
      settle(deps.morningPrompt?.id, markFeedbackSkipped);
      deps.setMorningPrompt(null);
    },
  };
}
