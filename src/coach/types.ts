/**
 * AI coach (PRD §11): natural-language goal → session configuration.
 * The intermediate schema mirrors the PRD's example JSON so a future LLM
 * provider can slot in behind the same interface — CoachProvider.interpret is
 * async for exactly that reason, even though the rule parser is synchronous.
 */
export type CoachGoal = 'study' | 'work' | 'relax' | 'sleep' | 'meditate' | 'energize';

export interface CoachRequest {
  goal: CoachGoal | null;
  energy: 'low' | 'normal' | 'high' | null;
  durationMin: number | null;
  /** 0..1 — reserved; the mapper derives it from goal+energy when null. */
  desiredArousal: number | null;
  /** 0..1 — parsed and recorded, not yet used to bias the sound (v1). */
  distractionMasking: number | null;
}

export interface CoachInterpretation {
  request: CoachRequest;
  /** 0..1 — below the mapper's threshold the UI falls back to manual setup. */
  confidence: number;
  matchedPhrases: string[];
}

export interface CoachProvider {
  interpret(text: string): Promise<CoachInterpretation>;
}
