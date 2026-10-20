// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultProgram, programMinDurationSec } from '../programs/types';
import { RoutineEditor } from './RoutineEditor';

const program = { ...defaultProgram('relax', 0.3), id: 'p1', name: 'Unwind' };
const routine = {
  id: 'r1',
  name: 'Evening',
  createdAt: '2026-10-19T08:00:00.000Z',
  legs: [
    { state: 'focus' as const, intensity: 0.5, minutes: 25 },
    { state: 'focus' as const, intensity: 0.5, minutes: 5 },
  ],
};

describe('RoutineEditor', () => {
  it('a part can play a saved program — it takes the program’s state and length (Phase 17)', () => {
    const onSave = vi.fn();
    render(<RoutineEditor routine={routine} programs={[program]} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getAllByRole('slider', { name: /Depth/ })).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Part 2 sound' }), { target: { value: 'p1' } });
    // The program owns the depth: its slider gives way to a note.
    expect(screen.getAllByRole('slider', { name: /Depth/ })).toHaveLength(1);
    expect(screen.getByText(/Plays your “Unwind” program/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Part 2 state' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    const saved = onSave.mock.calls[0][0];
    expect(saved.legs[1]).toMatchObject({
      state: 'relax',
      programId: 'p1',
      minutes: Math.max(5, Math.ceil(programMinDurationSec(program) / 60)),
    });
  });

  it('switching back to a personalized sound drops the program', () => {
    const onSave = vi.fn();
    render(
      <RoutineEditor
        routine={{ ...routine, legs: [routine.legs[0], { ...routine.legs[1], programId: 'p1' }] }}
        programs={[program]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Part 2 sound' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect('programId' in onSave.mock.calls[0][0].legs[1]).toBe(false);
  });

  it('offers no sound picker when there are no programs', () => {
    render(<RoutineEditor routine={routine} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: /sound/ })).toBeNull();
  });
});
