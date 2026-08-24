import { useState } from 'react';
import { STATES, type MentalState } from '../audio/states';
import { PROGRAM_TEMPLATES, type ProgramTemplate } from '../programs/templates';
import { programMinDurationSec, type Program } from '../programs/types';
import type { PersonalizationMode, Preset } from '../storage/types';
import { DurationPicker } from './DurationPicker';
import { HeadphoneHint, NoDrivingWarning } from './SafetyNotices';
import { StatePicker } from './StatePicker';

/** PRD §4: state → intensity → duration → generate. */
export function SetupScreen(props: {
  state: MentalState;
  intensity: number;
  minutes: number;
  presets: Preset[];
  selectedPresetId: string | undefined;
  programs: Program[];
  selectedProgramId: string | undefined;
  monoMode: boolean;
  chimeEnabled: boolean;
  adaptationEnabled: boolean;
  starting: boolean;
  /** True once this state is past the bandit's cold start (PRD §9). */
  personalizationActive: boolean;
  personalizationMode: PersonalizationMode;
  /** True once any state has enough data for the insights screen (PRD §10). */
  insightsAvailable: boolean;
  onStateChange: (state: MentalState) => void;
  onIntensityChange: (intensity: number) => void;
  onMinutesChange: (minutes: number) => void;
  onSelectPreset: (preset: Preset | undefined) => void;
  onDeletePreset: (id: string) => void;
  onSelectProgram: (program: Program | undefined) => void;
  onDeleteProgram: (id: string) => void;
  onNewProgram: (template: ProgramTemplate) => void;
  onEditProgram: (program: Program) => void;
  onOpenLab: () => void;
  onToggleMono: (mono: boolean) => void;
  onToggleChime: (chime: boolean) => void;
  onToggleAdaptation: (enabled: boolean) => void;
  onModeChange: (mode: PersonalizationMode) => void;
  onShowInsights: () => void;
  onBegin: () => void;
}) {
  const stateDef = STATES[props.state];
  const statePresets = props.presets.filter((p) => p.state === props.state);
  const [showTemplates, setShowTemplates] = useState(false);
  const selectedProgram = props.programs.find((p) => p.id === props.selectedProgramId);
  const programMinMinutes = selectedProgram
    ? Math.ceil(programMinDurationSec(selectedProgram) / 60)
    : 0;

  return (
    <>
      <section className="setup-section">
        <h2 className="setup-question">What do you want to feel?</h2>
        <StatePicker value={props.state} onChange={props.onStateChange} />
      </section>

      {!selectedProgram && (
        <section className="setup-section">
          <h2 className="setup-question">How deep?</h2>
          <div className="intensity-row">
            <span className="intensity-label">{stateDef.intensityLabels[0]}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={props.intensity}
              onChange={(e) => props.onIntensityChange(Number(e.target.value))}
            />
            <span className="intensity-label">{stateDef.intensityLabels[1]}</span>
          </div>
        </section>
      )}

      <section className="setup-section">
        <h2 className="setup-question">For how long?</h2>
        <DurationPicker minutes={props.minutes} onChange={props.onMinutesChange} />
        {selectedProgram && props.minutes < programMinMinutes && (
          <p className="hint">
            “{selectedProgram.name}” needs at least {programMinMinutes} min — the
            session will run that long; extra time extends the final phase.
          </p>
        )}
      </section>

      {statePresets.length > 0 && (
        <section className="setup-section">
          <h2 className="setup-question">Your saved sounds</h2>
          <div className="preset-strip">
            {statePresets.map((preset) => (
              <span
                key={preset.id}
                className={`chip preset-chip${
                  preset.id === props.selectedPresetId ? ' selected' : ''
                }`}
              >
                <button
                  type="button"
                  className="preset-name"
                  onClick={() =>
                    props.onSelectPreset(
                      preset.id === props.selectedPresetId ? undefined : preset,
                    )
                  }
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="preset-delete"
                  aria-label={`Delete preset ${preset.name}`}
                  onClick={() => props.onDeletePreset(preset.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {props.selectedPresetId && (
            <p className="hint">Replaying your saved sound for this state.</p>
          )}
        </section>
      )}

      <section className="setup-section">
        <h2 className="setup-question">Timed programs</h2>
        {props.programs.length > 0 && (
          <div className="preset-strip">
            {props.programs.map((program) => (
              <span
                key={program.id}
                className={`chip preset-chip${
                  program.id === props.selectedProgramId ? ' selected' : ''
                }`}
              >
                <button
                  type="button"
                  className="preset-name"
                  onClick={() =>
                    props.onSelectProgram(
                      program.id === props.selectedProgramId ? undefined : program,
                    )
                  }
                >
                  {program.name}
                </button>
                <button
                  type="button"
                  className="preset-delete"
                  aria-label={`Delete program ${program.name}`}
                  onClick={() => props.onDeleteProgram(program.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="preset-strip program-actions">
          <button
            type="button"
            className={`chip${showTemplates ? ' selected' : ''}`}
            onClick={() => setShowTemplates((v) => !v)}
          >
            + New program
          </button>
          {selectedProgram && (
            <button
              type="button"
              className="chip"
              onClick={() => props.onEditProgram(selectedProgram)}
            >
              Edit “{selectedProgram.name}”
            </button>
          )}
        </div>
        {showTemplates && (
          <>
            <p className="hint">Start from:</p>
            <div className="preset-strip">
              {PROGRAM_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="chip"
                  title={template.description}
                  onClick={() => {
                    setShowTemplates(false);
                    props.onNewProgram(template);
                  }}
                >
                  {template.emoji ? `${template.emoji} ` : ''}
                  {template.label}
                </button>
              ))}
            </div>
          </>
        )}
        {selectedProgram && (
          <p className="hint">
            {selectedProgram.segments.length} phases · shapes intensity, tempo, and
            texture over time.
          </p>
        )}
      </section>

      {props.personalizationActive && (
        <label className="mono-toggle lock-toggle">
          <input
            type="checkbox"
            checked={props.personalizationMode === 'locked'}
            onChange={(e) =>
              props.onModeChange(e.target.checked ? 'locked' : 'explore')
            }
          />
          Lock what works — stop experimenting with new variations
        </label>
      )}

      <label className="mono-toggle adaptation-toggle">
        <input
          type="checkbox"
          checked={props.adaptationEnabled}
          onChange={(e) => props.onToggleAdaptation(e.target.checked)}
        />
        Adapt mid-session — occasionally check in and adjust the sound
      </label>

      <HeadphoneHint monoMode={props.monoMode} onToggleMono={props.onToggleMono} />
      {stateDef.end.chime === 'optional' && (
        <label className="mono-toggle chime-toggle">
          <input
            type="checkbox"
            checked={props.chimeEnabled}
            onChange={(e) => props.onToggleChime(e.target.checked)}
          />
          Gentle chime when the session ends
        </label>
      )}
      {stateDef.noDrivingWarning && <NoDrivingWarning />}

      <div className="transport begin-row">
        <button
          type="button"
          className="play-button"
          disabled={props.starting}
          onClick={props.onBegin}
        >
          {props.starting
            ? 'Starting…'
            : `► Begin ${Math.max(props.minutes, programMinMinutes)} min`}
        </button>
      </div>

      {props.insightsAvailable && (
        <button type="button" className="link-button" onClick={props.onShowInsights}>
          Your sound profile →
        </button>
      )}

      <button type="button" className="link-button" onClick={props.onOpenLab}>
        Sound lab →
      </button>
    </>
  );
}
