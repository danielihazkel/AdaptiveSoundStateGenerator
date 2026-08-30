import type { CheckpointResponse } from '../adaptation/types';
import type { BreathPattern } from '../audio/breathing';
import { STATES, type MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { useSessionPlatform } from '../platform/useSessionPlatform';
import type { Program } from '../programs/types';
import { MAX_END_AT_MINUTES } from '../session/durationLimits';
import { EXTEND_SEC, type SessionController } from '../session/sessionController';
import { useSession } from '../session/useSession';
import { SessionScreen } from '../ui/SessionScreen';

/** Binds a running controller to the session screen and the platform glue. */
export function SessionView(props: {
  controller: SessionController;
  mentalState: MentalState;
  program?: Program;
  /** Guided breathing pattern the mix follows (pacer), if any. */
  breathing?: BreathPattern;
  profile: SoundProfile;
  onProfileChange: (next: SoundProfile) => void;
  onStop: () => void;
  onSavePreset: (name: string) => void;
  microPrompt?: {
    onRespond: (response: CheckpointResponse) => void;
    onDismiss: () => void;
  };
}) {
  const snapshot = useSession(props.controller);
  const stateDef = STATES[props.mentalState];
  const durationSec = snapshot.elapsedSec + snapshot.remainingSec;
  // Plain sessions can grow by +15 min up to the longest "End at" span.
  const extendable = !props.program && durationSec + EXTEND_SEC <= MAX_END_AT_MINUTES * 60;
  useSessionPlatform(props.controller, snapshot, {
    title: `${stateDef.label} · ${Math.round(durationSec / 60)} min`,
    subtitle: props.program ? `Resonance · ${props.program.name}` : undefined,
    durationSec,
  });
  return (
    <SessionScreen
      stateDef={STATES[props.mentalState]}
      snapshot={snapshot}
      program={props.program}
      breathing={props.breathing}
      profile={props.profile}
      onProfileChange={props.onProfileChange}
      onPause={() => void props.controller.pause()}
      onResume={() => void props.controller.resume()}
      onStop={props.onStop}
      onExtend={extendable ? () => void props.controller.extend() : undefined}
      onDismissAlarm={() => props.controller.dismissAlarm()}
      onSnooze={() => void props.controller.snooze()}
      onSavePreset={props.onSavePreset}
      microPrompt={props.microPrompt}
    />
  );
}
