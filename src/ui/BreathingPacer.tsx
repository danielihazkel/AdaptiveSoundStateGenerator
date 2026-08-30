import { useEffect, useState } from 'react';
import { breathsPerMinute } from './breathing';

/**
 * Visual breath pacer for breathing-rate pulses (calm). Purely UI-side: the
 * engine's LFO phase isn't observable, and a few hundred ms of offset is
 * imperceptible on a 7–10 s breath. Inhale on the first half of the cycle,
 * exhale on the second, matching the CSS `breathe` keyframes.
 */
export function BreathingPacer(props: { rateHz: number; paused: boolean }) {
  const periodSec = 1 / props.rateHz;
  const [inhale, setInhale] = useState(true);

  useEffect(() => {
    if (props.paused) return;
    setInhale(true);
    const id = setInterval(() => setInhale((v) => !v), (periodSec / 2) * 1000);
    return () => clearInterval(id);
  }, [periodSec, props.paused]);

  return (
    <div
      className="pacer"
      aria-label={`Breathing pacer, ${breathsPerMinute(props.rateHz)} breaths per minute`}
    >
      <div
        className={`pacer-circle${props.paused ? ' paused' : ''}`}
        style={{ '--period': `${periodSec}s` } as React.CSSProperties}
        aria-hidden="true"
      />
      <span className="pacer-caption" role="status" aria-live="off">
        {props.paused ? 'Paused' : inhale ? 'Breathe in' : 'Breathe out'}
      </span>
    </div>
  );
}
