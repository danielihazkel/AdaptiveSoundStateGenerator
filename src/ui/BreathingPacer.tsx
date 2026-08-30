import { breathPhaseAt, patternPeriodSec, type BreathPattern } from '../audio/breathing';

const PHASE_TEXT = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' } as const;

/**
 * Visual breath pacer. Driven by session elapsed time through the same
 * `breathPhaseAt` the engine's breath swell uses, so circle and sound agree
 * (the 500 ms snapshot cadence is imperceptible on a 4–8 s phase). The
 * circle transitions to each phase's target size over that phase's length;
 * holds keep the size reached.
 */
export function BreathingPacer(props: {
  pattern: BreathPattern;
  elapsedSec: number;
  paused: boolean;
}) {
  const at = breathPhaseAt(props.pattern, props.elapsedSec);
  const phase = props.pattern.phases[at.index];
  // Where the circle should be heading, and how long it has to get there.
  const target =
    phase.label === 'in' ? 'full' : phase.label === 'out' ? 'empty' : holdTarget(props.pattern, at.index);
  const breathsPerMinute = Math.round((60 / patternPeriodSec(props.pattern)) * 10) / 10;
  const label =
    props.pattern.id === 'pulse'
      ? `Breathing pacer, ${Math.round(breathsPerMinute)} breaths per minute`
      : `Breathing pacer, ${props.pattern.label}`;

  return (
    <div className="pacer" role="group" aria-label={label}>
      <div
        className={`pacer-circle ${target}${props.paused ? ' paused' : ''}`}
        style={
          {
            '--phase': `${Math.max(0.2, phase.label === 'hold' ? 0.2 : phase.seconds)}s`,
          } as React.CSSProperties
        }
        aria-hidden="true"
      />
      {/* The sound is the pacer; announcing every phase change would be noise. */}
      <span className="pacer-caption" aria-hidden="true">
        {props.paused
          ? 'Paused'
          : `${PHASE_TEXT[phase.label]}${phase.label === 'hold' || phase.seconds >= 3 ? ` · ${Math.ceil(at.remainingSec)}` : ''}`}
      </span>
    </div>
  );
}

/** A hold keeps the size of the breath before it. */
function holdTarget(pattern: BreathPattern, index: number): 'full' | 'empty' {
  const n = pattern.phases.length;
  for (let k = 1; k <= n; k++) {
    const prev = pattern.phases[(((index - k) % n) + n) % n];
    if (prev.label === 'in') return 'full';
    if (prev.label === 'out') return 'empty';
  }
  return 'empty';
}
