import type { MentalState } from '../audio/states';
import type { Preset, SessionRecord } from '../storage/types';

/** The bandit arm behind a replayed session or a saved preset. */
export interface SourceArm {
  state: MentalState;
  armId: string;
}

export type SourceArmResolver = (record: SessionRecord) => SourceArm | null;

/** Replay chains (a replay of a replay) are followed at most this far. */
const MAX_HOPS = 8;

/**
 * Choosing to replay a sound is a label the bandit can learn from (PRD §15),
 * but the replayed session itself never served an arm. This resolves the arm
 * that originally produced the sound: the source session's served arm — or,
 * when that session adapted mid-way, the arm that was playing at the end,
 * because a replay plays the final profile. A preset carries its source
 * session id when it was saved from the feedback screen.
 *
 * Returns null when the source can't be trusted as a clean arm label: it was
 * customized by hand, it belongs to another state, or it is unknown.
 */
export function makeSourceArmResolver(
  sessions: readonly SessionRecord[],
  presets: readonly Preset[],
): SourceArmResolver {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const presetById = new Map(presets.map((p) => [p.id, p]));
  return (record) => {
    let sourceId: string | undefined = record.replayOfSessionId;
    if (!sourceId && record.presetId) {
      const preset = presetById.get(record.presetId);
      if (!preset || preset.state !== record.state) return null;
      sourceId = preset.sourceSessionId;
    }
    for (let hop = 0; sourceId && hop < MAX_HOPS; hop += 1) {
      const source = byId.get(sourceId);
      if (!source || source.state !== record.state || source.customized) return null;
      const armId = armThatPlayedLast(source);
      if (armId) return { state: source.state, armId };
      // A replay of a replay: keep walking back to the served session.
      sourceId = source.replayOfSessionId;
    }
    return null;
  };
}

function armThatPlayedLast(source: SessionRecord): string | null {
  if (!source.servedArmId || source.servedBy === 'preset') return null;
  const segments = source.segments;
  if (segments && segments.length > 0) return segments[segments.length - 1].armId;
  return source.servedArmId;
}
