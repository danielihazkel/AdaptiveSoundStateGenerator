import { useEffect, useState } from 'react';

/** The screen goes dark this long after the session starts or the last touch. */
export const NIGHTSTAND_DARK_AFTER_MS = 20_000;

/**
 * Nightstand mode: an OLED-black cover over the session screen with only a
 * dim clock. The wake lock keeps the display on for the whole session (so
 * audio survives on phones) — without this a sleep session would light the
 * bedroom all night. Any tap or key press lifts the cover; it settles back
 * after a quiet spell. `hold` keeps it lifted while something needs the
 * user (a check-in, the alarm, an interruption).
 */
export function NightstandOverlay(props: {
  active: boolean;
  hold: boolean;
  /** Time left (or elapsed, open-ended), already formatted. */
  clock: string;
}) {
  const [dark, setDark] = useState(false);
  const [lastTouch, setLastTouch] = useState(() => Date.now());
  const enabled = props.active && !props.hold;

  // Any interaction with the page counts as a touch and restarts the quiet spell.
  useEffect(() => {
    if (!props.active) return;
    const touch = (e: Event) => {
      // A tap on the cover is handled by its own click: lifting it on
      // pointerdown would let that click land on whatever is underneath
      // (Stop, say).
      if (e.target instanceof Element && e.target.closest('.nightstand-overlay')) return;
      setDark(false);
      setLastTouch(Date.now());
    };
    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    return () => {
      document.removeEventListener('pointerdown', touch, true);
      document.removeEventListener('keydown', touch, true);
    };
  }, [props.active]);

  useEffect(() => {
    if (!enabled) return;
    const wait = Math.max(0, NIGHTSTAND_DARK_AFTER_MS - (Date.now() - lastTouch));
    const timer = setTimeout(() => setDark(true), wait);
    return () => clearTimeout(timer);
  }, [enabled, lastTouch]);

  if (!enabled || !dark) return null;
  const now = new Date();
  const wallClock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <button
      type="button"
      className="nightstand-overlay"
      aria-label="Show session controls"
      onClick={() => {
        setDark(false);
        setLastTouch(Date.now());
      }}
    >
      <span className="nightstand-time">{wallClock}</span>
      <span className="nightstand-remaining">{props.clock}</span>
    </button>
  );
}
