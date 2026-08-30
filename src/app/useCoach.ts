import { useRef, useState } from 'react';
import { STATES } from '../audio/states';
import { COACH_CONFIDENCE_THRESHOLD, coachPlan, type CoachPlan } from '../coach/mapToSession';
import { ruleCoachProvider } from '../coach/ruleParser';

/**
 * The natural-language coach (PRD §11): turns a sentence into a setup, and
 * remembers that it did so the next begin() can stamp the session `coachUsed`.
 */
export function useCoach() {
  /** Setup was filled by the coach; consumed by the next begin(). */
  const appliedRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (
    text: string,
    setup: { setMinutes: (m: number) => void; applyCoachPlan: (plan: CoachPlan) => void },
  ) => {
    const interpretation = await ruleCoachProvider.interpret(text);
    const plan =
      interpretation.confidence >= COACH_CONFIDENCE_THRESHOLD
        ? coachPlan(interpretation.request)
        : null;
    if (!plan) {
      // Keep whatever *was* understood (usually a duration) and fall back.
      if (interpretation.request.durationMin) {
        setup.setMinutes(interpretation.request.durationMin);
      }
      setMessage("I couldn't quite tell what you're after — pick a state below.");
      return;
    }
    setup.applyCoachPlan(plan);
    appliedRef.current = true;
    const def = STATES[plan.state];
    const depth =
      plan.intensity < 0.4
        ? def.intensityLabels[0].toLowerCase()
        : plan.intensity > 0.6
          ? def.intensityLabels[1].toLowerCase()
          : 'balanced';
    setMessage(
      `${def.emoji} ${def.label} · ${depth} · ${plan.minutes} min — press Begin when ready.`,
    );
  };

  return {
    message,
    submit,
    /** Whether the coach filled the current setup; clears the flag. */
    consumeApplied: (): boolean => {
      const applied = appliedRef.current;
      appliedRef.current = false;
      return applied;
    },
    /** Picking a state manually overrides whatever the coach set up. */
    reset: () => {
      appliedRef.current = false;
      setMessage(null);
    },
  };
}

export type Coach = ReturnType<typeof useCoach>;
