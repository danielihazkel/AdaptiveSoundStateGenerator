import { useState } from 'react';
import { BREATH_PATTERNS, type BreathingPatternId } from '../audio/breathing';
import { STATES, type MentalState } from '../audio/states';
import { BREATH_STATES, WAKE_UP_STATES } from '../session/sessionOptions';
import { EXPORT_MAX_SECONDS } from '../export/renderTimeline';
import { exportMaxSeconds } from '../export/options';
import type { Mp3Exporter } from '../export/useMp3Export';
import {
  DEFAULT_INTERVALS,
  INTERVAL_LIMITS,
  INTERVAL_STATES,
  intervalTotalSec,
  type IntervalPlan,
} from '../programs/intervals';
import { PROGRAM_TEMPLATES, type ProgramTemplate } from '../programs/templates';
import { formatMinutes, minutesUntil } from '../session/wallClock';
import { programMinDurationSec, type Program } from '../programs/types';
import {
  MAX_WAKE_RISE_MINUTES,
  MIN_WAKE_RISE_MINUTES,
  THEMES,
  type PersonalizationMode,
  type Preset,
  type SessionRecord,
  type Settings,
  type Theme,
} from '../storage/types';
import { formatDuration } from './format';
import { useRadioGroup } from './useRadioGroup';
import { ExportRow } from './ExportRow';
import { PresetStrip } from './PresetStrip';
import { DurationPicker } from './DurationPicker';
import { HeadphoneHint, NoDrivingWarning } from './SafetyNotices';
import { ShareButton } from './ShareButton';
import { StatePicker } from './StatePicker';

/** Screen-reader text for the depth slider — the labels are the design, never numbers. */
export function intensityValueText(labels: readonly [string, string], intensity: number): string {
  if (intensity < 0.33) return labels[0];
  if (intensity > 0.66) return labels[1];
  return `between ${labels[0].toLowerCase()} and ${labels[1].toLowerCase()}`;
}

/** PRD §4: state → intensity → duration → generate. */
export function SetupScreen(props: {
  state: MentalState;
  intensity: number;
  minutes: number;
  /** "End at HH:MM" mode, or null for a fixed length. */
  endAt: string | null;
  onEndAtChange: (endAt: string | null) => void;
  openEnded: boolean;
  onOpenEndedChange: (openEnded: boolean) => void;
  breathingPattern: BreathingPatternId;
  onBreathingPatternChange: (id: BreathingPatternId) => void;
  wakeUp: NonNullable<Settings['wakeUp']>;
  onWakeUpChange: (wakeUp: NonNullable<Settings['wakeUp']>) => void;
  /** Interval (Pomodoro) plan, when working in intervals. */
  intervals: IntervalPlan | null;
  onIntervalsChange: (plan: IntervalPlan | null) => void;
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
  /** True once at least one session has been recorded. */
  historyAvailable: boolean;
  /** Session being replayed from history, if any. */
  replay: SessionRecord | null;
  onClearReplay: () => void;
  /** Why the last Begin failed, if it did. */
  startError: string | null;
  onShowHistory: () => void;
  onStateChange: (state: MentalState) => void;
  onIntensityChange: (intensity: number) => void;
  onMinutesChange: (minutes: number) => void;
  onSelectPreset: (preset: Preset | undefined) => void;
  onDeletePreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
  onToggleFavoritePreset: (id: string, favorite: boolean) => void;
  onMovePreset: (id: string, direction: -1 | 1) => void;
  onSelectProgram: (program: Program | undefined) => void;
  onDeleteProgram: (id: string) => void;
  onNewProgram: (template: ProgramTemplate) => void;
  onEditProgram: (program: Program) => void;
  onOpenLab: () => void;
  onToggleMono: (mono: boolean) => void;
  onToggleChime: (chime: boolean) => void;
  onToggleAdaptation: (enabled: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** Most recent session, for one-tap replay; null with no history. */
  lastSession: SessionRecord | null;
  onPlayLast: () => void;
  onModeChange: (mode: PersonalizationMode) => void;
  onShowInsights: () => void;
  onBegin: () => void;
  exporter: Mp3Exporter;
  onDownload: () => void;
}) {
  const stateDef = STATES[props.state];
  const statePresets = props.presets.filter((p) => p.state === props.state);
  const [showTemplates, setShowTemplates] = useState(false);
  const selectedProgram = props.programs.find((p) => p.id === props.selectedProgramId);
  const programMinMinutes = selectedProgram
    ? Math.ceil(programMinDurationSec(selectedProgram) / 60)
    : 0;
  const intervals = !selectedProgram && INTERVAL_STATES.has(props.state) ? props.intervals : null;
  const chosenMinutes =
    (props.endAt !== null ? minutesUntil(props.endAt, new Date()) : null) ?? props.minutes;
  const sessionMinutes = intervals
    ? intervalTotalSec(intervals) / 60
    : Math.max(chosenMinutes, programMinMinutes);
  const showIntervals = !selectedProgram && INTERVAL_STATES.has(props.state);
  const showBreathing = !selectedProgram && BREATH_STATES.has(props.state);
  // "Until I stop" only applies to a plain session: programs and intervals
  // fix their own length.
  const openEnded = props.openEnded && !selectedProgram && !intervals;
  const showWakeUp = !selectedProgram && !openEnded && WAKE_UP_STATES.has(props.state);
  const exportMaxSec = exportMaxSeconds(props.exporter.options, EXPORT_MAX_SECONDS);
  const exportFormat = props.exporter.options.format.toUpperCase();
  const exportCapped = !openEnded && sessionMinutes * 60 > exportMaxSec;
  const exportMinutes = exportCapped ? exportMaxSec / 60 : sessionMinutes;
  const themeGroup = useRadioGroup<Theme>({
    items: THEMES,
    value: props.theme,
    onChange: props.onThemeChange,
    getKey: (t) => t,
  });
  const last = props.lastSession;

  return (
    <>
      {last && !props.replay && (
        <button
          type="button"
          className="play-last"
          disabled={props.starting}
          onClick={props.onPlayLast}
        >
          <span className="play-last-title">▶ Play last</span>
          <span className="hint">
            {STATES[last.state].emoji} {STATES[last.state].label} ·{' '}
            {formatDuration(last.plannedDurationSec)} · {relativeDay(last.startedAt)}
          </span>
        </button>
      )}

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
              aria-label="How deep"
              aria-valuetext={intensityValueText(stateDef.intensityLabels, props.intensity)}
              onChange={(e) => props.onIntensityChange(Number(e.target.value))}
            />
            <span className="intensity-label">{stateDef.intensityLabels[1]}</span>
          </div>
        </section>
      )}

      {showIntervals && (
        <section className="setup-section">
          <h2 className="setup-question">Work in intervals?</h2>
          <div className="preset-strip">
            <button
              type="button"
              className={`chip${intervals ? ' selected' : ''}`}
              aria-pressed={intervals !== null}
              onClick={() => props.onIntervalsChange(intervals ? null : DEFAULT_INTERVALS)}
            >
              🍅 Intervals
            </button>
          </div>
          {intervals && (
            <>
              <div className="option-row hint">
                <IntervalField
                  label="Work"
                  value={intervals.workMin}
                  range={INTERVAL_LIMITS.work}
                  onChange={(workMin) => props.onIntervalsChange({ ...intervals, workMin })}
                />
                <IntervalField
                  label="Break"
                  value={intervals.breakMin}
                  range={INTERVAL_LIMITS.break}
                  onChange={(breakMin) => props.onIntervalsChange({ ...intervals, breakMin })}
                />
                <IntervalField
                  label="Cycles"
                  value={intervals.cycles}
                  range={INTERVAL_LIMITS.cycles}
                  onChange={(cycles) => props.onIntervalsChange({ ...intervals, cycles })}
                  unit=""
                />
              </div>
              <label className="mono-toggle">
                <input
                  type="checkbox"
                  checked={intervals.boundaryChime}
                  onChange={(e) =>
                    props.onIntervalsChange({ ...intervals, boundaryChime: e.target.checked })
                  }
                />
                Chime at each switch
              </label>
              <p className="hint">
                {intervals.cycles} × {intervals.workMin} min work with {intervals.breakMin} min
                breaks — {formatMinutes(intervalTotalSec(intervals) / 60)} in total. Breaks keep
                the sound going, softer and slower.
              </p>
            </>
          )}
        </section>
      )}

      {!intervals && (
      <section className="setup-section">
        <h2 className="setup-question">For how long?</h2>
        <DurationPicker
          minutes={props.minutes}
          onChange={props.onMinutesChange}
          endAt={props.endAt}
          onEndAtChange={props.onEndAtChange}
          openEnded={openEnded}
          onOpenEndedChange={props.onOpenEndedChange}
        />
        {openEnded && (
          <p className="hint">
            Plays until you press Stop — the sound settles into its steady state and stays there.
          </p>
        )}
        {selectedProgram && chosenMinutes < programMinMinutes && (
          <p className="hint">
            “{selectedProgram.name}” needs at least {programMinMinutes} min — the
            session will run that long; extra time extends the final phase.
          </p>
        )}
      </section>
      )}

      {showBreathing && (
        <section className="setup-section">
          <h2 className="setup-question">Breathe with</h2>
          <div className="preset-strip">
            {(['pulse', 'box', 'relax478', 'coherent'] as BreathingPatternId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`chip${props.breathingPattern === id ? ' selected' : ''}`}
                aria-pressed={props.breathingPattern === id}
                onClick={() => props.onBreathingPatternChange(id)}
              >
                {id === 'pulse' ? 'Follow the pulse' : BREATH_PATTERNS[id].label}
              </button>
            ))}
          </div>
          <p className="hint">
            {props.breathingPattern === 'pulse'
              ? 'The pacer follows the sound’s own slow pulse where it has one.'
              : 'The whole mix swells with each breath and the pacer shows every phase.'}
          </p>
        </section>
      )}

      {showWakeUp && (
        <section className="setup-section">
          <label className="mono-toggle wake-toggle">
            <input
              type="checkbox"
              checked={props.wakeUp.enabled}
              onChange={(e) => props.onWakeUpChange({ ...props.wakeUp, enabled: e.target.checked })}
            />
            Wake me up — rise gently at the end and finish with a chime
          </label>
          {props.wakeUp.enabled && (
            <label className="option-row hint">
              Rise over the last
              <input
                type="number"
                min={MIN_WAKE_RISE_MINUTES}
                max={MAX_WAKE_RISE_MINUTES}
                value={props.wakeUp.riseMinutes}
                aria-label="Wake-up rise length in minutes"
                onChange={(e) => {
                  const raw = Math.round(Number(e.target.value));
                  if (Number.isFinite(raw)) {
                    props.onWakeUpChange({
                      ...props.wakeUp,
                      riseMinutes: Math.min(
                        MAX_WAKE_RISE_MINUTES,
                        Math.max(MIN_WAKE_RISE_MINUTES, raw),
                      ),
                    });
                  }
                }}
              />
              minutes
            </label>
          )}
        </section>
      )}

      {props.replay && (
        <div className="notice replay-row">
          <span>
            ↺ Replaying your {STATES[props.replay.state].label.toLowerCase()} session
            from {new Date(props.replay.startedAt).toLocaleDateString()} — the exact
            sound it played.
          </span>
          <button
            type="button"
            className="chip"
            aria-label="Stop replaying"
            onClick={props.onClearReplay}
          >
            ✕
          </button>
        </div>
      )}

      {statePresets.length > 0 && (
        <section className="setup-section">
          <h2 className="setup-question">Your saved sounds</h2>
          <PresetStrip
            presets={statePresets}
            selectedId={props.selectedPresetId}
            onSelect={props.onSelectPreset}
            onDelete={props.onDeletePreset}
            onRename={props.onRenamePreset}
            onToggleFavorite={props.onToggleFavoritePreset}
            onMove={props.onMovePreset}
          />
          {props.selectedPresetId && (
            <div className="preset-strip program-actions">
              <span className="hint">Replaying your saved sound for this state.</span>
              <ShareButton
                ariaLabel="Share this sound"
                getPayload={() => {
                  const preset = statePresets.find((p) => p.id === props.selectedPresetId)!;
                  return {
                    v: 1,
                    kind: 'preset',
                    preset: {
                      name: preset.name,
                      state: preset.state,
                      intensity: preset.intensity,
                      profile: preset.profile,
                    },
                  };
                }}
              />
            </div>
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
                  aria-pressed={program.id === props.selectedProgramId}
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
            aria-expanded={showTemplates}
            onClick={() => setShowTemplates((v) => !v)}
          >
            + New program
          </button>
          {selectedProgram && (
            <>
              <button
                type="button"
                className="chip"
                onClick={() => props.onEditProgram(selectedProgram)}
              >
                Edit “{selectedProgram.name}”
              </button>
              <ShareButton
                ariaLabel={`Share program ${selectedProgram.name}`}
                getPayload={() => ({ v: 1, kind: 'program', program: selectedProgram })}
              />
            </>
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
      <div className="option-row theme-row">
        <span className="hint" id="theme-label">
          Appearance
        </span>
        <div className="preset-strip" {...themeGroup.groupProps} aria-labelledby="theme-label">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${props.theme === t ? ' selected' : ''}`}
              {...themeGroup.itemProps(t)}
              onClick={() => props.onThemeChange(t)}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
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
            : openEnded
              ? '► Begin · until you stop'
              : props.endAt !== null && !selectedProgram && !intervals
                ? `► Begin · ends ${props.endAt}`
                : `► Begin ${formatMinutes(sessionMinutes)}`}
        </button>
      </div>
      {props.startError && (
        <p className="notice warning" role="alert">
          {props.startError}
        </p>
      )}

      <ExportRow
        exporter={props.exporter}
        label={
          openEnded
            ? `⤓ Download ${exportFormat}`
            : `⤓ Download ${exportMinutes} min ${exportFormat}`
        }
        onDownload={props.onDownload}
        disabled={openEnded}
      />
      {openEnded && !props.exporter.progress && (
        <p className="hint">Pick a length above to download this sound.</p>
      )}
      {exportCapped && !props.exporter.progress && (
        <p className="hint">
          {exportFormat} downloads are capped at {exportMaxSec / 60} minutes — the file will
          cover the first {exportMinutes} min of this session.
        </p>
      )}

      {props.insightsAvailable && (
        <button type="button" className="link-button" onClick={props.onShowInsights}>
          Your sound profile →
        </button>
      )}

      {props.historyAvailable && (
        <button type="button" className="link-button" onClick={props.onShowHistory}>
          Session history →
        </button>
      )}

      <button type="button" className="link-button" onClick={props.onOpenLab}>
        Sound lab →
      </button>
    </>
  );
}

const THEME_LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** "today" / "yesterday" / "3 days ago" / a date. */
function relativeDay(iso: string, now = new Date()): string {
  const days = Math.floor(
    (new Date(now.toDateString()).getTime() - new Date(new Date(iso).toDateString()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function IntervalField(props: {
  label: string;
  value: number;
  range: readonly [number, number];
  onChange: (value: number) => void;
  unit?: string;
}) {
  const [min, max] = props.range;
  return (
    <label className="option-row">
      {props.label}
      <input
        type="number"
        min={min}
        max={max}
        value={props.value}
        aria-label={`${props.label} ${props.unit ?? 'minutes'}`.trim()}
        onChange={(e) => {
          const raw = Math.round(Number(e.target.value));
          if (Number.isFinite(raw)) props.onChange(Math.min(max, Math.max(min, raw)));
        }}
      />
      {props.unit ?? 'min'}
    </label>
  );
}
