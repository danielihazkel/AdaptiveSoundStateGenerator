import { useState } from 'react';
import type { SoundExplanation } from '../personalization/explain';

/**
 * "Why this sound" (Phase 15, PRD §20): the variation playing and why the
 * personalizer picked it, one tap away from how it has scored so far. The
 * learning loop is the product — this is where the user gets to see it.
 */
export function WhySound(props: { explanation: SoundExplanation }) {
  const [open, setOpen] = useState(false);
  const { label, reason, scorePct, ciPct, note } = props.explanation;
  return (
    <div className="why-sound">
      <button
        type="button"
        className="link-button inline"
        aria-expanded={open}
        aria-controls="why-sound-detail"
        onClick={() => setOpen((v) => !v)}
      >
        {label} · {reason}
      </button>
      {open && (
        <p className="hint" id="why-sound-detail">
          {scorePct !== undefined
            ? `Scores ${scorePct}% ±${ciPct ?? 0} for you so far — your rating at the end refines it.`
            : (note ??
              'No ratings for this one yet — your rating at the end teaches the app what works for you.')}
        </p>
      )}
    </div>
  );
}
