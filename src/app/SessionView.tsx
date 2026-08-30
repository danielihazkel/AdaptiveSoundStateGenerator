import type { CheckpointResponse } from '../adaptation/types';
import { STATES, type MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { useSessionPlatform } from '../platform/useSessionPlatform';
import type { Program } from '../programs/types';
import type { SessionController } from '../session/sessionController';
import { useSession } from '../session/useSession';
import { SessionScreen } from '../ui/SessionScreen';

/** Binds a running controller to the session screen and the platform glue. */
export function SessionView(props: {
  controller: SessionController;
  mentalState: MentalState;
  program?: Program;
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
      profile={props.profile}
      onProfileChange={props.onProfileChange}
      onPause={() => void props.controller.pause()}
      onResume={() => void props.controller.resume()}
      onStop={props.onStop}
      onSavePreset={props.onSavePreset}
      microPrompt={props.microPrompt}
    />
  );
}
