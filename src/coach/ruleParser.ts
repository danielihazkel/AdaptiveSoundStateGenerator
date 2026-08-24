import type {
  CoachGoal,
  CoachInterpretation,
  CoachProvider,
  CoachRequest,
} from './types';

/**
 * Local rule-based parser (PRD §11) — deterministic, offline, dependency-free.
 * Keyword lexicons are matched on word boundaries so "sleepy" (energy) never
 * matches "sleep" (goal). The canonical example must hold:
 * "I'm tired but need to study for two hours" → {study, low, 120}.
 */

/** Multi-word phrases listed before single words so they win the match. */
const GOAL_KEYWORDS: Array<[string, CoachGoal]> = [
  ['deep work', 'work'],
  ['fall asleep', 'sleep'],
  ['go to bed', 'sleep'],
  ['wake up', 'energize'],
  ['wind down', 'relax'],
  ['calm down', 'relax'],
  ['study', 'study'],
  ['studying', 'study'],
  ['exam', 'study'],
  ['read', 'study'],
  ['reading', 'study'],
  ['learn', 'study'],
  ['work', 'work'],
  ['working', 'work'],
  ['focus', 'work'],
  ['concentrate', 'work'],
  ['code', 'work'],
  ['coding', 'work'],
  ['program', 'work'],
  ['write', 'work'],
  ['writing', 'work'],
  ['relax', 'relax'],
  ['relaxing', 'relax'],
  ['calm', 'relax'],
  ['unwind', 'relax'],
  ['chill', 'relax'],
  ['stressed', 'relax'],
  ['stress', 'relax'],
  ['anxious', 'relax'],
  ['anxiety', 'relax'],
  ['destress', 'relax'],
  ['sleep', 'sleep'],
  ['nap', 'sleep'],
  ['bed', 'sleep'],
  ['insomnia', 'sleep'],
  ['meditate', 'meditate'],
  ['meditating', 'meditate'],
  ['meditation', 'meditate'],
  ['mindful', 'meditate'],
  ['mindfulness', 'meditate'],
  ['breathe', 'meditate'],
  ['breathing', 'meditate'],
  ['energize', 'energize'],
  ['energized', 'energize'],
  ['energy', 'energize'],
  ['workout', 'energize'],
  ['exercise', 'energize'],
  ['alert', 'energize'],
  ['awake', 'energize'],
  ['pumped', 'energize'],
];

const LOW_ENERGY_KEYWORDS = [
  'tired',
  'exhausted',
  'sleepy',
  'drained',
  'fatigued',
  'drowsy',
  'low energy',
  'worn out',
  'burned out',
  'burnt out',
];

const HIGH_ENERGY_KEYWORDS = [
  'wired',
  'restless',
  'jittery',
  'hyper',
  'racing',
  "can't sit still",
  'too much energy',
];

const MASKING_KEYWORDS = [
  'noisy',
  'loud',
  'distracting',
  'distractions',
  'distracted',
  'block out',
  'drown out',
  'mask',
  'open office',
  'chatter',
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  a: 1,
  an: 1,
};

export const MIN_COACH_MINUTES = 5;
export const MAX_COACH_MINUTES = 180;

function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
}

function clampMinutes(min: number): number {
  return Math.min(MAX_COACH_MINUTES, Math.max(MIN_COACH_MINUTES, Math.round(min)));
}

/** "two hours", "45 min", "half an hour", "an hour and a half", "1.5h", … */
export function parseDuration(text: string): number | null {
  if (/\bhalf an hour\b/.test(text)) return 30;
  if (/\ba couple of hours\b/.test(text)) return 120;
  if (/\ban? hour and a half\b/.test(text)) return 90;

  const numberWord = Object.keys(NUMBER_WORDS).join('|');
  const hourMatch = text.match(
    new RegExp(`\\b(\\d+(?:\\.\\d+)?|${numberWord})\\s*(?:hours?|hrs?|h)\\b`),
  );
  if (hourMatch) {
    const raw = hourMatch[1];
    const hours = NUMBER_WORDS[raw] ?? Number(raw);
    if (Number.isFinite(hours) && hours > 0) {
      const andAHalf = /\band a half\b/.test(text) ? 0.5 : 0;
      return clampMinutes((hours + andAHalf) * 60);
    }
  }

  const minuteMatch = text.match(
    new RegExp(`\\b(\\d+|${numberWord})\\s*(?:minutes?|mins?|min)\\b`),
  );
  if (minuteMatch) {
    const raw = minuteMatch[1];
    const minutes = NUMBER_WORDS[raw] ?? Number(raw);
    if (Number.isFinite(minutes) && minutes > 0) return clampMinutes(minutes);
  }

  return null;
}

export function parseGoalText(text: string): CoachInterpretation {
  const lower = text.toLowerCase();
  const matchedPhrases: string[] = [];

  // Tally goal votes; ties break toward the goal matched first (keyword
  // order runs specific → generic), since Map preserves insertion order and
  // later equal counts never replace the leader.
  const votes = new Map<CoachGoal, number>();
  for (const [phrase, goal] of GOAL_KEYWORDS) {
    if (!hasPhrase(lower, phrase)) continue;
    matchedPhrases.push(phrase);
    votes.set(goal, (votes.get(goal) ?? 0) + 1);
  }
  let goal: CoachGoal | null = null;
  let bestVotes = 0;
  for (const [g, v] of votes) {
    if (v > bestVotes) {
      goal = g;
      bestVotes = v;
    }
  }

  let energy: CoachRequest['energy'] = null;
  for (const phrase of LOW_ENERGY_KEYWORDS) {
    if (hasPhrase(lower, phrase)) {
      energy = 'low';
      matchedPhrases.push(phrase);
      break;
    }
  }
  if (!energy) {
    for (const phrase of HIGH_ENERGY_KEYWORDS) {
      if (hasPhrase(lower, phrase)) {
        energy = 'high';
        matchedPhrases.push(phrase);
        break;
      }
    }
  }

  const durationMin = parseDuration(lower);

  let distractionMasking: number | null = null;
  for (const phrase of MASKING_KEYWORDS) {
    if (hasPhrase(lower, phrase)) {
      distractionMasking = 0.7;
      matchedPhrases.push(phrase);
      break;
    }
  }

  const confidence = goal
    ? Math.min(0.85, 0.6 + (energy ? 0.1 : 0) + (durationMin !== null ? 0.15 : 0))
    : energy || durationMin !== null
      ? 0.35
      : 0.1;

  return {
    request: { goal, energy, durationMin, desiredArousal: null, distractionMasking },
    confidence,
    matchedPhrases,
  };
}

/** The default (and only, v1) provider — a future LLM one implements the same seam. */
export const ruleCoachProvider: CoachProvider = {
  interpret: (text) => Promise.resolve(parseGoalText(text)),
};
