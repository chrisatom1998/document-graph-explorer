// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TrackStructure from './TrackStructure';

afterEach(cleanup);
const structure = { revision: 1, drops: [30.5, 120], sections: [
  { start: 0, end: 30.5, label: 'intro' as const }, { start: 30.5, end: 90, label: 'drop' as const },
  { start: 90, end: 120, label: 'breakdown' as const }, { start: 120, end: 180, label: 'drop' as const }, { start: 180, end: 200, label: 'outro' as const },
] };

it('lists each mix point and seeks to it', () => {
  const onSeek = vi.fn();
  render(<TrackStructure structure={structure} duration={200} onSeek={onSeek} />);
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Intro0:00', 'Drop 10:30', 'Breakdown1:30', 'Drop 22:00', 'Outro3:00']);
  fireEvent.click(screen.getByRole('button', { name: 'Play from drop 2 at 2:00' }));
  expect(onSeek).toHaveBeenCalledWith(120);
});

it('shows nothing when no structure was found', () => {
  const { container } = render(<TrackStructure structure={{ revision: 1, drops: [], sections: [] }} duration={200} />);
  expect(container.innerHTML).toBe('');
});
