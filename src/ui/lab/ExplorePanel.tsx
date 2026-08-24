import type { MentalState } from '../../audio/states';
import {
  buildCandidateProfile,
  candidatesFor,
} from '../../personalization/candidates';
import type { SoundProfile } from '../../audio/types';

/**
 * Exploration tools: a bounded random draw, plus the bandit's candidate arms
 * for the current state — audition exactly what the personalizer would serve.
 */
export function ExplorePanel(props: {
  state: MentalState;
  intensity: number;
  onRandomize: () => void;
  onApply: (profile: SoundProfile) => void;
}) {
  return (
    <section className="panel explore-panel">
      <div className="panel-header">
        <h2>Explore</h2>
      </div>
      <div className="preset-strip">
        <button type="button" className="chip" onClick={props.onRandomize}>
          🎲 Randomize
        </button>
      </div>
      <p className="hint">Personalizer candidates for this state:</p>
      <div className="preset-strip">
        {candidatesFor(props.state).map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="chip"
            onClick={() =>
              props.onApply(
                buildCandidateProfile(props.state, props.intensity, candidate.id),
              )
            }
          >
            {candidate.label}
          </button>
        ))}
      </div>
    </section>
  );
}
