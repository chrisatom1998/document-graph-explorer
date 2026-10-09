// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DocNode } from '../../model/types';
vi.mock('../../persistence/originals', () => ({ getOriginal: vi.fn(async () => undefined) }));
vi.mock('../SidePanel', () => ({ default: () => <div data-testid="full-details">Full details with its own player</div> }));
import ConnectedClips from './ConnectedClips';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';

const clip = (id: string): DocNode => ({ id, title: id, path: `${id}.wav`, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 1, status: 'ok' });

beforeEach(() => {
  // jsdom has no scrollIntoView; the inspector pins its toggle into view when details open.
  Element.prototype.scrollIntoView = vi.fn();
  useGraphStore.getState().reset();
  useGraphStore.getState().addNodes([clip('first'), clip('second')]);
  useGraphStore.getState().setEdges([{ id: 'e', source: 'first', target: 'second', kind: 'tempo', weight: 0.8, evidence: ['Same tempo'] }]);
  useUiStore.getState().setSelected('first');
});
afterEach(() => { cleanup(); useUiStore.getState().setSelected(null); useGraphStore.getState().reset(); });

it('drops the inspector card player for the selected clip while Full details shows its own', async () => {
  const view = render(<ConnectedClips detailsOpen={false} onToggleDetails={() => {}} />);
  expect(screen.getByRole('button', { name: 'Play first' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Play second' })).toBeInTheDocument();
  view.rerender(<ConnectedClips detailsOpen onToggleDetails={() => {}} />);
  await screen.findByTestId('full-details');
  expect(screen.queryByRole('button', { name: 'Play first' })).toBeNull();
  // The connected clip is not in Full details, so its card keeps its player.
  expect(screen.getByRole('button', { name: 'Play second' })).toBeInTheDocument();
});
