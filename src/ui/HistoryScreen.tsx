import { useMemo, useState } from 'react';
import { STATES } from '../audio/states';
import { summarizeHistory } from '../personalization/history';
import type { Program } from '../programs/types';
import type { Preset, SessionRecord } from '../storage/types';
import { formatDuration } from './format';

const PAGE = 50;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Session history: what you've listened to, how it went, and one-tap replay of
 * the exact sound a session played. Records are stored newest-first.
 */
export function HistoryScreen(props: {
  sessions: SessionRecord[];
  programs: Program[];
  presets: Preset[];
  onReplay: (record: SessionRecord) => void;
  onUseProgram: (program: Program) => void;
  onBack: () => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const summary = useMemo(() => summarizeHistory(props.sessions, new Date()), [props.sessions]);
  const programById = new Map(props.programs.map((p) => [p.id, p]));
  const presetById = new Map(props.presets.map((p) => [p.id, p]));

  return (
    <div className="history">
      <h2>Session history</h2>
      <p className="hint">Every session this device has played, newest first.</p>

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-value">{summary.thisWeek}</span>
          <span className="stat-label">sessions this week</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.minutesThisWeek}</span>
          <span className="stat-label">minutes this week</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.currentStreakDays}</span>
          <span className="stat-label">day streak</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.total}</span>
          <span className="stat-label">total</span>
        </div>
      </div>

      {props.sessions.length === 0 && (
        <p className="hint">No sessions yet — your first one will show up here.</p>
      )}

      <div className="history-list">
        {props.sessions.slice(0, shown).map((s) => {
          const stateDef = STATES[s.state];
          const program = s.programId ? programById.get(s.programId) : undefined;
          const preset = s.presetId ? presetById.get(s.presetId) : undefined;
          const adapted = (s.segments?.length ?? 0) > 1;
          return (
            <div key={s.id} className="history-row">
              <span className="history-when">{formatWhen(s.startedAt)}</span>
              <span className="history-main">
                {stateDef.emoji} {stateDef.label}
                <span className="history-meta"> · {formatDuration(s.actualDurationSec)}</span>
                <span className="history-meta">
                  {' · '}
                  {s.feedback ? `${'★'.repeat(s.feedback.rating)}` : 'unrated'}
                </span>
              </span>
              {!s.completed && !s.recovered && <span className="badge early">stopped early</span>}
              {s.recovered && <span className="badge">ended unexpectedly</span>}
              {program && <span className="badge">{program.name}</span>}
              {s.programId && !program && <span className="badge">program (deleted)</span>}
              {s.intervals && (
                <span className="badge">
                  intervals {s.intervals.workMin}/{s.intervals.breakMin} ×{s.intervals.cycles}
                </span>
              )}
              {preset && <span className="badge">{preset.name}</span>}
              {adapted && <span className="badge">adapted</span>}
              {s.coachUsed && <span className="badge">coach</span>}
              {s.programId ? (
                program && (
                  <button type="button" className="chip" onClick={() => props.onUseProgram(program)}>
                    Use program
                  </button>
                )
              ) : (
                <button type="button" className="chip" onClick={() => props.onReplay(s)}>
                  ↺ {s.intervals ? 'Replay intervals' : 'Replay'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {props.sessions.length > shown && (
        <button
          type="button"
          className="link-button"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show more ({props.sessions.length - shown} older)
        </button>
      )}

      <button type="button" className="link-button" onClick={props.onBack}>
        ← Back
      </button>
    </div>
  );
}
