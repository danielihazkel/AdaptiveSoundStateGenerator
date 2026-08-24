import { STATES } from '../audio/states';
import type { SoundComponent, StateInsights } from '../personalization/insights';

const COMPONENT_LABELS: Record<SoundComponent, string> = {
  binaural: 'Binaural beats',
  noise: 'Noise',
  isochronic: 'Rhythmic pulses',
  tone: 'Pure tone',
  ambience: 'Ambience',
};

function formatHz(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Personal sound profile (PRD §10) — presentational only; all math in insights.ts. */
export function InsightsScreen(props: {
  insights: StateInsights[];
  onBack: () => void;
}) {
  return (
    <div className="insights">
      <h2>Your sound profile</h2>
      <p className="hint">
        Learned from your sessions — rated ones count most, finished ones count too.
      </p>

      {props.insights.map((insight) => {
        const stateDef = STATES[insight.state];
        const bars = insight.componentEffectiveness.filter((c) => c.sessionsOn > 0);
        return (
          <section key={insight.state} className="panel insight-card">
            <div className="panel-header">
              <h2>
                {stateDef.emoji} {stateDef.label}
              </h2>
              <span className="insight-meta">
                {insight.sessionCount} sessions
                {insight.avgRating !== null &&
                  ` · avg ${insight.avgRating.toFixed(1)}★`}
              </span>
            </div>

            {bars.length > 0 && (
              <div className="insight-bars">
                <p className="insight-label">Most effective</p>
                {bars.map((bar) => (
                  <div key={bar.component} className="insight-bar-row">
                    <span className="insight-bar-name">
                      {COMPONENT_LABELS[bar.component]}
                    </span>
                    <span className="insight-bar-track">
                      <span
                        className="insight-bar-fill"
                        style={{ width: `${Math.round(bar.avgRewardWhenOn * 100)}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}

            <dl className="insight-facts">
              {insight.bestArm && (
                <>
                  <dt>Best variation</dt>
                  <dd>{insight.bestArm.label}</dd>
                </>
              )}
              {insight.preferredBeatRange && (
                <>
                  <dt>Preferred beat</dt>
                  <dd>
                    {formatHz(insight.preferredBeatRange[0])}–
                    {formatHz(insight.preferredBeatRange[1])} Hz
                  </dd>
                </>
              )}
              {insight.preferredNoiseType && (
                <>
                  <dt>Preferred noise</dt>
                  <dd className="capitalize">{insight.preferredNoiseType}</dd>
                </>
              )}
              {insight.preferredVolume !== null && (
                <>
                  <dt>Preferred volume</dt>
                  <dd>{Math.round(insight.preferredVolume * 100)}%</dd>
                </>
              )}
              {insight.typicalDurationMin !== null && (
                <>
                  <dt>Typical duration</dt>
                  <dd>{Math.round(insight.typicalDurationMin)} min</dd>
                </>
              )}
            </dl>
          </section>
        );
      })}

      <button type="button" className="advanced-toggle" onClick={props.onBack}>
        ← Back
      </button>
    </div>
  );
}
