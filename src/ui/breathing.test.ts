import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { breathsPerMinute, pacerRateFor } from './breathing';

describe('pacerRateFor', () => {
  it('returns the calm pulse rate at both ends of the intensity range', () => {
    const lo = pacerRateFor(STATES.calm.buildProfile(0));
    const hi = pacerRateFor(STATES.calm.buildProfile(1));
    expect(lo).not.toBeNull();
    expect(hi).not.toBeNull();
    expect(lo!).toBeGreaterThan(hi!); // deeper calm = slower breathing
    expect(breathsPerMinute(lo!)).toBeLessThanOrEqual(10);
  });

  it('is null for rhythmic (non-breathing) states', () => {
    expect(pacerRateFor(STATES.focus.buildProfile(0.5))).toBeNull();
    expect(pacerRateFor(STATES.energy.buildProfile(0.5))).toBeNull();
  });

  it('is null when the pulse is off or in pattern mode', () => {
    const p = STATES.calm.buildProfile(0.5);
    expect(pacerRateFor({ ...p, isochronic: { ...p.isochronic, enabled: false } })).toBeNull();
    expect(pacerRateFor({ ...p, rhythm: { ...p.rhythm, mode: 'pattern' } })).toBeNull();
  });
});
