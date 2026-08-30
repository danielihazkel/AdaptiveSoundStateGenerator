/** m:ss, or h:mm:ss once an hour is reached. */
export function formatClock(totalSec: number): string {
  const whole = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Human duration for lists: "45 min", "1 h 20 min", "< 1 min". */
export function formatDuration(totalSec: number): string {
  const minutes = Math.round(totalSec / 60);
  if (minutes < 1) return '< 1 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** m:ss for lab readouts (never rolls into hours). */
export function formatMinSec(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
