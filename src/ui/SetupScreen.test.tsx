// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS } from '../export/options';
import type { Mp3Exporter } from '../export/useMp3Export';
import { DEFAULT_WAKE_UP } from '../storage/types';
import { SetupScreen } from './SetupScreen';

type Props = Parameters<typeof SetupScreen>[0];

function exporterStub(): Mp3Exporter {
  return {
    progress: null,
    message: null,
    start: vi.fn(async () => undefined),
    cancel: vi.fn(),
    options: DEFAULT_EXPORT_OPTIONS,
    setOptions: vi.fn(),
  };
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    state: 'focus',
    intensity: 0.5,
    minutes: 30,
    endAt: null,
    onEndAtChange: vi.fn(),
    openEnded: false,
    onOpenEndedChange: vi.fn(),
    breathingPattern: 'pulse',
    onBreathingPatternChange: vi.fn(),
    wakeUp: { ...DEFAULT_WAKE_UP },
    onWakeUpChange: vi.fn(),
    intervals: null,
    onIntervalsChange: vi.fn(),
    presets: [],
    selectedPresetId: undefined,
    programs: [],
    selectedProgramId: undefined,
    monoMode: false,
    chimeEnabled: true,
    adaptationEnabled: true,
    starting: false,
    personalizationActive: false,
    personalizationMode: 'explore',
    insightsAvailable: false,
    historyAvailable: false,
    replay: null,
    onClearReplay: vi.fn(),
    startError: null,
    onShowHistory: vi.fn(),
    onStateChange: vi.fn(),
    onIntensityChange: vi.fn(),
    onMinutesChange: vi.fn(),
    onSelectPreset: vi.fn(),
    onDeletePreset: vi.fn(),
    onRenamePreset: vi.fn(),
    onToggleFavoritePreset: vi.fn(),
    onMovePreset: vi.fn(),
    onSelectProgram: vi.fn(),
    onDeleteProgram: vi.fn(),
    onNewProgram: vi.fn(),
    onEditProgram: vi.fn(),
    onOpenLab: vi.fn(),
    onToggleMono: vi.fn(),
    onToggleChime: vi.fn(),
    onToggleAdaptation: vi.fn(),
    theme: 'system',
    onThemeChange: vi.fn(),
    lastSession: null,
    onPlayLast: vi.fn(),
    onModeChange: vi.fn(),
    onShowInsights: vi.fn(),
    onBegin: vi.fn(),
    exporter: exporterStub(),
    onDownload: vi.fn(),
    ...overrides,
  };
}

describe('SetupScreen', () => {
  it('Begin shows the planned length and starts the session', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<SetupScreen {...p} />);
    const begin = screen.getByRole('button', { name: /Begin 30 min/ });
    await user.click(begin);
    expect(p.onBegin).toHaveBeenCalledTimes(1);
  });

  it('Begin is disabled while a session is starting', () => {
    render(<SetupScreen {...props({ starting: true })} />);
    expect(screen.getByRole('button', { name: /Starting/ })).toBeDisabled();
  });

  it('shows the last start error', () => {
    render(<SetupScreen {...props({ startError: 'Could not start audio.' })} />);
    expect(screen.getByText('Could not start audio.')).toBeInTheDocument();
  });

  it('picking a state calls back and the picker reflects the selection', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<SetupScreen {...p} />);
    await user.click(screen.getByRole('radio', { name: /Sleep/ }));
    expect(p.onStateChange).toHaveBeenCalledWith('sleep');
  });

  it('"Until I stop" changes the Begin label', () => {
    render(<SetupScreen {...props({ openEnded: true })} />);
    expect(screen.getByRole('button', { name: /Begin · until you stop/ })).toBeInTheDocument();
  });
});
