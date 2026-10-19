import { resolveOutcome } from '../personalization/personalizer';
import { attachFeedback, markFeedbackSkipped } from '../storage/storage';
import type { FeedbackInput, Rating, SessionRecord } from '../storage/types';
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

  /**
   * A routine's earlier legs (Phase 14): rated ones get their rating; the
   * rest settle on their implicit signals right away — never as "skipped",
   * since only the final leg's rating was ever asked for outright.
   */
  const settleEarlierLegs = (legRatings: Record<string, Rating> = {}) => {
    for (const leg of deps.getLastSession()?.routineLegs ?? []) {
      const rating = legRatings[leg.recordId];
      if (rating !== undefined) attachFeedback(leg.recordId, { rating });
      resolveOutcome(leg.recordId);
    }
  };

  return {
    rate: (input: FeedbackInput, legRatings?: Record<string, Rating>) => {
      settleEarlierLegs(legRatings);
      settle(deps.getLastSession()?.recordId, (id) => attachFeedback(id, input));
      deps.onDone();
    },
    skip: () => {
      settleEarlierLegs();
      settle(deps.getLastSession()?.recordId, markFeedbackSkipped);
      deps.onDone();
    },
    /** The morning prompt asks the one question that matters after sleep. */
    morningRate: (rating: Rating) => {
      settle(deps.morningPrompt?.id, (id) => attachFeedback(id, { rating }));
      deps.setMorningPrompt(null);
    },
    morningDismiss: () => {
      settle(deps.morningPrompt?.id, markFeedbackSkipped);
      deps.setMorningPrompt(null);
    },
  };
}
