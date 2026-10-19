import type { Routine } from './types';

/**
 * Starting points for a new routine (Phase 14). Built-in, never stored:
 * using one plays it directly; editing one saves a copy.
 */
export interface RoutineTemplate {
  id: string;
  name: string;
  description: string;
  legs: Routine['legs'];
}

export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'morning-kickoff',
    name: 'Morning kick-off',
    description: 'Wake the body up, then settle into a long focus block.',
    legs: [
      { state: 'energy', intensity: 0.5, minutes: 10 },
      { state: 'focus', intensity: 0.6, minutes: 50 },
    ],
  },
  {
    id: 'deep-work',
    name: 'Deep work',
    description: 'Two focus blocks with a short, real rest between them.',
    legs: [
      { state: 'focus', intensity: 0.6, minutes: 50 },
      { state: 'relax', intensity: 0.4, minutes: 10 },
      { state: 'focus', intensity: 0.6, minutes: 50 },
    ],
  },
  {
    id: 'wind-down',
    name: 'Wind-down',
    description: 'Let the day go before the sleep sound takes over.',
    legs: [
      { state: 'relax', intensity: 0.5, minutes: 15 },
      { state: 'sleep', intensity: 0.6, minutes: 45 },
    ],
  },
];

/** A template as a playable routine (stable id, so its sessions group in history). */
export function routineFromTemplate(template: RoutineTemplate): Routine {
  return {
    id: `template:${template.id}`,
    name: template.name,
    createdAt: '2026-10-01T00:00:00.000Z',
    legs: template.legs.map((l) => ({ ...l })),
  };
}
