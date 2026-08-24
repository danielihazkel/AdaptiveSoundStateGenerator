import {
  cloneProfile,
  SAMPLE_AMBIENCE_TYPES,
  SYNTH_AMBIENCE_TYPES,
  type AmbienceType,
  type NoiseType,
  type RhythmMode,
  type SampleAmbienceType,
  type SoundProfile,
} from '../audio/types';
import { Slider } from './Slider';

const AMBIENCE_LABELS: Record<AmbienceType, string> = {
  rain: 'Rain',
  ocean: 'Ocean',
  wind: 'Wind',
  space: 'Space',
  forest: 'Forest',
  fireplace: 'Fireplace',
  cafe: 'Café',
};

/** UI-side loudness cap — part of the PRD §13 ceiling (see engine trims). */
export const MAX_MASTER_VOLUME = 0.85;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Live parameter panel for advanced users (PRD §15.4) — the Phase 0 test
 * bench, extended with isochronic pulses, stereo width, and blue noise.
 * Every edit produces a full new profile; the caller pushes it to the engine
 * via applyProfile, so all changes ramp click-free.
 */
export function AdvancedPanel(props: {
  profile: SoundProfile;
  onChange: (next: SoundProfile) => void;
  /** Sample ambience types with a shipped asset — the rest stay hidden. */
  availableSampleTypes?: ReadonlySet<SampleAmbienceType>;
}) {
  const p = props.profile;
  const sampleTypes = props.availableSampleTypes ?? new Set<SampleAmbienceType>();
  // An imported preset may name a sample type this install has no asset for:
  // show it (disabled-annotated) rather than silently rewriting the profile.
  const currentUnavailable =
    (SAMPLE_AMBIENCE_TYPES as readonly string[]).includes(p.ambience.type) &&
    !sampleTypes.has(p.ambience.type as SampleAmbienceType);
  const edit = (mutate: (draft: SoundProfile) => void) => {
    const draft = cloneProfile(p);
    mutate(draft);
    props.onChange(draft);
  };

  return (
    <div className="advanced-panel">
      <p className="readout">
        Carrier {Math.round(p.binaural.carrier)} Hz · Beat {p.binaural.beat.toFixed(1)} Hz ·
        Noise {pct(p.noise.level)} · Modulation {pct(p.isochronic.depth)} · Stereo{' '}
        {pct(p.stereoWidth)}
      </p>

      <section className="panel">
        <div className="panel-header">
          <h2>Master</h2>
        </div>
        <Slider
          label="Volume"
          min={0}
          max={MAX_MASTER_VOLUME}
          step={0.01}
          value={p.masterVolume}
          display={pct(p.masterVolume)}
          onChange={(v) => edit((d) => (d.masterVolume = v))}
        />
        <Slider
          label="Stereo width"
          min={0}
          max={1}
          step={0.01}
          value={p.stereoWidth}
          display={pct(p.stereoWidth)}
          onChange={(v) => edit((d) => (d.stereoWidth = v))}
        />
        <Slider
          label="Bass"
          min={0}
          max={1}
          step={0.01}
          value={p.bass}
          display={pct(p.bass)}
          onChange={(v) => edit((d) => (d.bass = v))}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Noise</h2>
          <input
            type="checkbox"
            checked={p.noise.enabled}
            onChange={(e) => edit((d) => (d.noise.enabled = e.target.checked))}
          />
        </div>
        <label className="control">
          <span>Type</span>
          <select
            value={p.noise.type}
            onChange={(e) => edit((d) => (d.noise.type = e.target.value as NoiseType))}
          >
            <option value="white">White</option>
            <option value="pink">Pink</option>
            <option value="brown">Brown</option>
            <option value="blue">Blue</option>
          </select>
          <span />
        </label>
        <Slider
          label="Level"
          min={0}
          max={1}
          step={0.01}
          value={p.noise.level}
          display={pct(p.noise.level)}
          onChange={(v) => edit((d) => (d.noise.level = v))}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Ambience</h2>
          <input
            type="checkbox"
            checked={p.ambience.enabled}
            onChange={(e) => edit((d) => (d.ambience.enabled = e.target.checked))}
          />
        </div>
        <label className="control">
          <span>Type</span>
          <select
            value={p.ambience.type}
            onChange={(e) => edit((d) => (d.ambience.type = e.target.value as AmbienceType))}
          >
            {SYNTH_AMBIENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {AMBIENCE_LABELS[t]}
              </option>
            ))}
            {SAMPLE_AMBIENCE_TYPES.filter((t) => sampleTypes.has(t)).map((t) => (
              <option key={t} value={t}>
                {AMBIENCE_LABELS[t]}
              </option>
            ))}
            {currentUnavailable && (
              <option value={p.ambience.type} disabled>
                {AMBIENCE_LABELS[p.ambience.type]} (no asset installed)
              </option>
            )}
          </select>
          <span />
        </label>
        <Slider
          label="Level"
          min={0}
          max={1}
          step={0.01}
          value={p.ambience.level}
          display={pct(p.ambience.level)}
          onChange={(v) => edit((d) => (d.ambience.level = v))}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Binaural beats</h2>
          <input
            type="checkbox"
            checked={p.binaural.enabled}
            onChange={(e) => edit((d) => (d.binaural.enabled = e.target.checked))}
          />
        </div>
        <Slider
          label="Carrier"
          min={80}
          max={600}
          step={1}
          value={p.binaural.carrier}
          display={`${p.binaural.carrier} Hz`}
          onChange={(v) => edit((d) => (d.binaural.carrier = v))}
        />
        <Slider
          label="Beat"
          min={1}
          max={30}
          step={0.5}
          value={p.binaural.beat}
          display={`${p.binaural.beat} Hz`}
          onChange={(v) => edit((d) => (d.binaural.beat = v))}
        />
        <Slider
          label="Level"
          min={0}
          max={1}
          step={0.01}
          value={p.binaural.level}
          display={pct(p.binaural.level)}
          onChange={(v) => edit((d) => (d.binaural.level = v))}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Rhythmic pulses</h2>
          <input
            type="checkbox"
            checked={p.isochronic.enabled}
            onChange={(e) => edit((d) => (d.isochronic.enabled = e.target.checked))}
          />
        </div>
        <label className="control">
          <span>Mode</span>
          <select
            value={p.rhythm.mode}
            onChange={(e) => edit((d) => (d.rhythm.mode = e.target.value as RhythmMode))}
          >
            <option value="simple">Simple (steady wobble)</option>
            <option value="pattern">Pattern (BPM + complexity)</option>
          </select>
          <span />
        </label>
        {p.rhythm.mode === 'simple' ? (
          <Slider
            label="Rate"
            min={0.5}
            max={16}
            step={0.5}
            value={p.isochronic.rate}
            display={`${p.isochronic.rate} Hz`}
            onChange={(v) => edit((d) => (d.isochronic.rate = v))}
          />
        ) : (
          <>
            <Slider
              label="Tempo"
              min={40}
              max={180}
              step={1}
              value={p.rhythm.bpm}
              display={`${Math.round(p.rhythm.bpm)} BPM`}
              onChange={(v) => edit((d) => (d.rhythm.bpm = v))}
            />
            <Slider
              label="Complexity"
              min={0}
              max={1}
              step={0.01}
              value={p.rhythm.complexity}
              display={pct(p.rhythm.complexity)}
              onChange={(v) => edit((d) => (d.rhythm.complexity = v))}
            />
          </>
        )}
        <Slider
          label="Depth"
          min={0}
          max={1}
          step={0.01}
          value={p.isochronic.depth}
          display={pct(p.isochronic.depth)}
          onChange={(v) => edit((d) => (d.isochronic.depth = v))}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Pure tone</h2>
          <input
            type="checkbox"
            checked={p.tone.enabled}
            onChange={(e) => edit((d) => (d.tone.enabled = e.target.checked))}
          />
        </div>
        <Slider
          label="Frequency"
          min={100}
          max={1000}
          step={1}
          value={p.tone.frequency}
          display={`${p.tone.frequency} Hz`}
          onChange={(v) => edit((d) => (d.tone.frequency = v))}
        />
        <Slider
          label="Level"
          min={0}
          max={1}
          step={0.01}
          value={p.tone.level}
          display={pct(p.tone.level)}
          onChange={(v) => edit((d) => (d.tone.level = v))}
        />
        <Slider
          label="Warmth"
          min={0}
          max={1}
          step={0.01}
          value={p.tone.warmth}
          display={pct(p.tone.warmth)}
          onChange={(v) => edit((d) => (d.tone.warmth = v))}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Harmonic pad</h2>
          <input
            type="checkbox"
            checked={p.harmony.enabled}
            onChange={(e) => edit((d) => (d.harmony.enabled = e.target.checked))}
          />
        </div>
        <Slider
          label="Root"
          min={55}
          max={440}
          step={1}
          value={p.harmony.rootHz}
          display={`${Math.round(p.harmony.rootHz)} Hz`}
          onChange={(v) => edit((d) => (d.harmony.rootHz = v))}
        />
        <Slider
          label="Level"
          min={0}
          max={1}
          step={0.01}
          value={p.harmony.level}
          display={pct(p.harmony.level)}
          onChange={(v) => edit((d) => (d.harmony.level = v))}
        />
        <Slider
          label="Richness"
          min={0}
          max={1}
          step={0.01}
          value={p.harmony.richness}
          display={pct(p.harmony.richness)}
          onChange={(v) => edit((d) => (d.harmony.richness = v))}
        />
        <Slider
          label="Movement"
          min={0}
          max={1}
          step={0.01}
          value={p.harmony.movement}
          display={pct(p.harmony.movement)}
          onChange={(v) => edit((d) => (d.harmony.movement = v))}
        />
      </section>
    </div>
  );
}
