import { useState } from 'react';
import { STATES, type MentalState } from '../audio/states';
import {
  AMBIENCE_TYPES,
  NOISE_TYPES,
  type AmbienceType,
  type NoiseType,
} from '../audio/types';
import { programExportSelection } from '../export/programExport';
import type { Mp3Exporter } from '../export/useMp3Export';
import { newId } from '../storage/id';
import {
  normalizeProgram,
  type Program,
  type ProgramSegment,
} from '../programs/types';
import { ExportRow } from './ExportRow';
import { exportMaxSeconds } from '../export/options';
import { EXPORT_MAX_SECONDS } from '../export/renderTimeline';
import { ShareButton } from './ShareButton';
import { Slider } from './Slider';
import { StatePicker } from './StatePicker';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Proportional colored overview bar; the open-ended tail gets a fixed share. */
function TimelineBar(props: { segments: ProgramSegment[] }) {
  const closed = props.segments.filter((s) => s.endMin !== null);
  const closedTotal = closed.reduce((sum, s) => sum + (s.endMin! - s.startMin), 0);
  const hasOpen = props.segments.some((s) => s.endMin === null);
  const openShare = hasOpen ? Math.max(closedTotal * 0.25, 5) : 0;
  const total = closedTotal + openShare || 1;
  return (
    <div className="program-timeline" aria-hidden="true">
      {props.segments.map((s) => {
        const span = s.endMin === null ? openShare : s.endMin - s.startMin;
        return (
          <div
            key={s.id}
            className="program-timeline-block"
            style={{
              flexGrow: span / total,
              opacity: 0.35 + s.intensity * 0.65,
            }}
            title={s.label}
          />
        );
      })}
    </div>
  );
}

function SegmentRow(props: {
  segment: ProgramSegment;
  index: number;
  count: number;
  onChange: (next: ProgramSegment) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const s = props.segment;
  const [showTexture, setShowTexture] = useState(false);
  const [showSound, setShowSound] = useState(false);
  const last = props.index === props.count - 1;
  const edit = (change: Partial<ProgramSegment>) => props.onChange({ ...s, ...change });
  /** Set or remove an optional override (absent = base sound). */
  const editOverride = <K extends keyof ProgramSegment>(key: K, value: ProgramSegment[K] | undefined) => {
    const next = { ...s };
    if (value === undefined) delete next[key];
    else next[key] = value;
    props.onChange(next);
  };

  return (
    <div className="segment-row">
      <div className="segment-row-header">
        <span className="segment-index">{props.index + 1}</span>
        <input
          type="text"
          className="segment-label"
          value={s.label}
          maxLength={40}
          onChange={(e) => edit({ label: e.target.value })}
        />
        <span className="segment-range">
          {s.startMin}–{s.endMin === null ? '∞' : s.endMin} min
        </span>
        <button
          type="button"
          className="chip"
          disabled={props.index === 0}
          aria-label="Move phase up"
          onClick={() => props.onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="chip"
          disabled={last}
          aria-label="Move phase down"
          onClick={() => props.onMove(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="preset-delete"
          disabled={props.count === 1}
          aria-label={`Remove phase ${s.label}`}
          onClick={props.onRemove}
        >
          ×
        </button>
      </div>

      <label className="control">
        <span>Ends at</span>
        {last ? (
          <label className="segment-open-toggle">
            <input
              type="checkbox"
              checked={s.endMin === null}
              onChange={(e) =>
                edit({ endMin: e.target.checked ? null : s.startMin + 10 })
              }
            />
            open-ended
          </label>
        ) : (
          <span />
        )}
        {s.endMin !== null ? (
          <span className="value">
            <input
              type="number"
              className="segment-end"
              min={s.startMin + 1}
              max={24 * 60}
              value={s.endMin}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (Number.isFinite(raw)) {
                  edit({ endMin: Math.max(s.startMin + 1, Math.round(raw)) });
                }
              }}
            />{' '}
            min
          </span>
        ) : (
          <span className="value">runs to session end</span>
        )}
      </label>

      <Slider
        label="Intensity"
        min={0}
        max={1}
        step={0.01}
        value={s.intensity}
        display={pct(s.intensity)}
        onChange={(v) => edit({ intensity: v })}
      />
      <Slider
        label="Tempo min"
        min={40}
        max={180}
        step={1}
        value={s.bpmRange[0]}
        display={`${s.bpmRange[0]} BPM`}
        onChange={(v) => edit({ bpmRange: [v, Math.max(v, s.bpmRange[1])] })}
      />
      <Slider
        label="Tempo max"
        min={40}
        max={180}
        step={1}
        value={s.bpmRange[1]}
        display={`${s.bpmRange[1]} BPM`}
        onChange={(v) => edit({ bpmRange: [Math.min(v, s.bpmRange[0]), v] })}
      />
      <Slider
        label="Complexity"
        min={0}
        max={1}
        step={0.01}
        value={s.complexity}
        display={pct(s.complexity)}
        onChange={(v) => edit({ complexity: v })}
      />

      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={showTexture}
        onClick={() => setShowTexture((v) => !v)}
      >
        {showTexture ? '▾ Hide texture' : '▸ Texture'}
      </button>
      {showTexture && (
        <>
          <Slider
            label="Noise"
            min={0}
            max={2}
            step={0.05}
            value={s.noiseScale ?? 1}
            display={`×${(s.noiseScale ?? 1).toFixed(2)}`}
            onChange={(v) => edit({ noiseScale: v })}
          />
          <Slider
            label="Ambience"
            min={0}
            max={2}
            step={0.05}
            value={s.ambienceScale ?? 1}
            display={`×${(s.ambienceScale ?? 1).toFixed(2)}`}
            onChange={(v) => edit({ ambienceScale: v })}
          />
          <Slider
            label="Tone"
            min={0}
            max={2}
            step={0.05}
            value={s.toneScale ?? 1}
            display={`×${(s.toneScale ?? 1).toFixed(2)}`}
            onChange={(v) => edit({ toneScale: v })}
          />
          <Slider
            label="Brightness"
            min={0.3}
            max={1}
            step={0.05}
            value={s.lowpassScale ?? 1}
            display={`×${(s.lowpassScale ?? 1).toFixed(2)}`}
            onChange={(v) => edit({ lowpassScale: v })}
          />
          <Slider
            label="Harmony"
            min={0}
            max={2}
            step={0.05}
            value={s.harmonyScale ?? 1}
            display={`×${(s.harmonyScale ?? 1).toFixed(2)}`}
            onChange={(v) => edit({ harmonyScale: v })}
          />
          <Slider
            label="Bass"
            min={0}
            max={2}
            step={0.05}
            value={s.bassScale ?? 1}
            display={`×${(s.bassScale ?? 1).toFixed(2)}`}
            onChange={(v) => edit({ bassScale: v })}
          />
          <label className="control">
            <span>Warmth</span>
            <label className="segment-open-toggle">
              <input
                type="checkbox"
                checked={s.warmth !== undefined}
                onChange={(e) => edit({ warmth: e.target.checked ? 0.8 : undefined })}
              />
              override
            </label>
            <span className="value">
              {s.warmth === undefined ? 'base sound' : pct(s.warmth)}
            </span>
          </label>
          {s.warmth !== undefined && (
            <Slider
              label=""
              min={0}
              max={1}
              step={0.01}
              value={s.warmth}
              display={pct(s.warmth)}
              onChange={(v) => edit({ warmth: v })}
            />
          )}
        </>
      )}

      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={showSound}
        onClick={() => setShowSound((v) => !v)}
      >
        {showSound ? '▾ Hide sound' : '▸ Sound'}
      </button>
      {showSound && (
        <>
          <p className="hint">
            Absolute overrides for this phase — unchecked means the base sound.
            Beat and carrier glide across the phase boundary; noise and
            ambience dissolve over a few seconds.
          </p>
          <label className="control">
            <span>Beat</span>
            <label className="segment-open-toggle">
              <input
                type="checkbox"
                checked={s.beatHz !== undefined}
                onChange={(e) => editOverride('beatHz', e.target.checked ? 10 : undefined)}
              />
              override
            </label>
            <span className="value">
              {s.beatHz === undefined ? 'base sound' : `${s.beatHz.toFixed(1)} Hz`}
            </span>
          </label>
          {s.beatHz !== undefined && (
            <Slider
              label=""
              min={0.5}
              max={40}
              step={0.5}
              value={s.beatHz}
              display={`${s.beatHz.toFixed(1)} Hz`}
              onChange={(v) => edit({ beatHz: v })}
            />
          )}
          <label className="control">
            <span>Carrier</span>
            <label className="segment-open-toggle">
              <input
                type="checkbox"
                checked={s.carrierHz !== undefined}
                onChange={(e) => editOverride('carrierHz', e.target.checked ? 200 : undefined)}
              />
              override
            </label>
            <span className="value">
              {s.carrierHz === undefined ? 'base sound' : `${Math.round(s.carrierHz)} Hz`}
            </span>
          </label>
          {s.carrierHz !== undefined && (
            <Slider
              label=""
              min={60}
              max={600}
              step={5}
              value={s.carrierHz}
              display={`${Math.round(s.carrierHz)} Hz`}
              onChange={(v) => edit({ carrierHz: v })}
            />
          )}
          <label className="control">
            <span>Noise color</span>
            <label className="segment-open-toggle">
              <input
                type="checkbox"
                checked={s.noiseType !== undefined}
                onChange={(e) => editOverride('noiseType', e.target.checked ? 'pink' : undefined)}
              />
              override
            </label>
            {s.noiseType !== undefined ? (
              <select
                value={s.noiseType}
                onChange={(e) => edit({ noiseType: e.target.value as NoiseType })}
              >
                {NOISE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="value">base sound</span>
            )}
          </label>
          <label className="control">
            <span>Ambience</span>
            <label className="segment-open-toggle">
              <input
                type="checkbox"
                checked={s.ambienceType !== undefined}
                onChange={(e) => editOverride('ambienceType', e.target.checked ? 'rain' : undefined)}
              />
              override
            </label>
            {s.ambienceType !== undefined ? (
              <select
                value={s.ambienceType}
                onChange={(e) => edit({ ambienceType: e.target.value as AmbienceType })}
              >
                {AMBIENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === 'cafe' ? 'Café' : t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="value">base sound</span>
            )}
          </label>
          <label className="control">
            <span>Pad richness</span>
            <label className="segment-open-toggle">
              <input
                type="checkbox"
                checked={s.harmonyRichness !== undefined}
                onChange={(e) =>
                  editOverride('harmonyRichness', e.target.checked ? 0.5 : undefined)
                }
              />
              override
            </label>
            <span className="value">
              {s.harmonyRichness === undefined ? 'base sound' : pct(s.harmonyRichness)}
            </span>
          </label>
          {s.harmonyRichness !== undefined && (
            <Slider
              label=""
              min={0}
              max={1}
              step={0.01}
              value={s.harmonyRichness}
              display={pct(s.harmonyRichness)}
              onChange={(v) => edit({ harmonyRichness: v })}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Re-derive contiguous start minutes after any structural edit. */
function reflow(segments: ProgramSegment[]): ProgramSegment[] {
  let cursor = 0;
  return segments.map((s, i) => {
    const last = i === segments.length - 1;
    const span = s.endMin === null ? null : Math.max(1, s.endMin - s.startMin);
    const next: ProgramSegment = {
      ...s,
      startMin: cursor,
      endMin: span === null ? (last ? null : cursor + 5) : cursor + span,
    };
    cursor = next.endMin ?? cursor;
    return next;
  });
}

/**
 * Full-screen visual segment editor for timed programs. The draft is only
 * committed (via normalizeProgram) on save; cancel discards everything.
 */
export function ProgramEditor(props: {
  program: Program;
  exporter: Mp3Exporter;
  chimeEnabled: boolean;
  onSave: (program: Program) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Program>(props.program);
  /** The program as it would be saved — also what Download renders. */
  const commit = (): Program =>
    normalizeProgram({ ...draft, name: draft.name.trim() || 'Program' });
  const exportMaxSec = exportMaxSeconds(props.exporter.options, EXPORT_MAX_SECONDS);
  const exportMinutes = Math.round(
    Math.min(programExportSelection(commit(), props.chimeEnabled).sel.durationSec, exportMaxSec) / 60,
  );

  const editSegments = (segments: ProgramSegment[]) =>
    setDraft((d) => ({ ...d, segments: reflow(segments) }));

  const updateBase = (state: MentalState, intensity: number) =>
    setDraft((d) => ({
      ...d,
      baseState: state,
      baseIntensity: intensity,
      // The base sound snapshot follows the picker; a custom baseProfile
      // (e.g. saved from the lab) is only kept while the picker is untouched.
      baseProfile: STATES[state].buildProfile(intensity),
    }));

  const addSegment = () => {
    const lastSegment = draft.segments[draft.segments.length - 1];
    editSegments([
      ...draft.segments.map((s, i) =>
        i === draft.segments.length - 1 && s.endMin === null
          ? { ...s, endMin: s.startMin + 10 }
          : s,
      ),
      {
        id: newId(),
        startMin: 0, // reflow fixes this
        endMin: null,
        label: `Phase ${draft.segments.length + 1}`,
        intensity: lastSegment.intensity,
        bpmRange: [...lastSegment.bpmRange] as [number, number],
        complexity: lastSegment.complexity,
      },
    ]);
  };

  const moveSegment = (index: number, direction: -1 | 1) => {
    const next = [...draft.segments];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    editSegments(next);
  };

  return (
    <section className="program-editor">
      <h2 className="setup-question">Design a timed program</h2>
      <label className="control program-name-row">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          maxLength={60}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <span />
      </label>

      <h3 className="setup-question">Base sound</h3>
      <StatePicker
        value={draft.baseState}
        onChange={(state) => updateBase(state, draft.baseIntensity)}
      />
      <Slider
        label="Base depth"
        min={0}
        max={1}
        step={0.01}
        value={draft.baseIntensity}
        display={pct(draft.baseIntensity)}
        onChange={(v) => updateBase(draft.baseState, v)}
      />

      <h3 className="setup-question">Phases</h3>
      <TimelineBar segments={draft.segments} />
      {draft.segments.map((segment, index) => (
        <SegmentRow
          key={segment.id}
          segment={segment}
          index={index}
          count={draft.segments.length}
          onChange={(next) =>
            editSegments(draft.segments.map((s) => (s.id === next.id ? next : s)))
          }
          onRemove={() =>
            editSegments(draft.segments.filter((s) => s.id !== segment.id))
          }
          onMove={(direction) => moveSegment(index, direction)}
        />
      ))}
      <button type="button" className="chip" onClick={addSegment}>
        + Add phase
      </button>

      <label className="mono-toggle">
        <input
          type="checkbox"
          checked={draft.boundaryChime === true}
          onChange={(e) =>
            setDraft((d) => {
              const next = { ...d };
              if (e.target.checked) next.boundaryChime = true;
              else delete next.boundaryChime;
              return next;
            })
          }
        />
        Chime at each phase change
      </label>

      <div className="transport begin-row">
        <button
          type="button"
          className="play-button"
          disabled={draft.name.trim() === ''}
          onClick={() => props.onSave(commit())}
        >
          Save program
        </button>
        <button type="button" className="stop-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <div className="preset-strip program-actions">
        <ShareButton
          label="⇪ Share link"
          getPayload={() => ({ v: 1, kind: 'program', program: commit() })}
        />
      </div>
      <ExportRow
        exporter={props.exporter}
        label={`⤓ Download ${exportMinutes} min ${props.exporter.options.format.toUpperCase()}`}
        onDownload={() => {
          const { sel, label } = programExportSelection(commit(), props.chimeEnabled);
          void props.exporter.start(sel, label);
        }}
      />
    </section>
  );
}
