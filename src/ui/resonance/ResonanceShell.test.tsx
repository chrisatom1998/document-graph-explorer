// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';

vi.mock('./ResonanceFilters', () => ({ default: () => <aside>Filters</aside> }));
vi.mock('./ConnectedClips', () => ({ default: () => <aside>Connected documents</aside> }));
vi.mock('./CollabMenuItems', () => ({ default: () => null }));
vi.mock('../SnapshotDiffBanner', () => ({ default: () => null }));
vi.mock('../DimsToggleButton', () => ({ DimsToggleButton: () => <button type="button">Dimensions</button> }));
vi.mock('../GraphNavigator', () => ({ default: () => <div>Library contents</div> }));
vi.mock('../ExportImportMenu', () => ({ default: () => <div>Export contents</div> }));
vi.mock('../CorpusSwitcher', () => ({ default: () => <span>Corpus</span> }));
vi.mock('../SavedViewsSection', () => ({ default: () => null }));

import ResonanceShell from './ResonanceShell';

const documentNode: DocNode = {
  id: 'doc',
  kind: 'document',
  title: 'Document',
  fileType: 'txt',
  topics: [],
  entities: [],
  keywords: ['architecture'],
  wordCount: 10,
  cluster: -1,
  degree: 0,
  status: 'ok',
};

describe('ResonanceShell progressive usability', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([documentNode]);
    useGraphStore.setState({ phase: 'embedding', graphUsable: true });
    useUiStore.setState({ searchOpen: false, pathMode: false });
  });

  afterEach(cleanup);

  it('enables read-only discovery tools while final graph actions stay gated', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    expect(screen.getByRole('status')).toHaveTextContent('Refining connections…');
    const search = screen.getByRole('button', { name: 'Search documents' });
    expect(search).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Library' })).toBeEnabled();

    fireEvent.click(search);
    expect(useUiStore.getState().searchOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    expect(screen.getByRole('menuitem', { name: /find a path/i })).toBeDisabled();

    act(() => useGraphStore.setState({ graphUsable: false }));
    expect(screen.getByRole('button', { name: 'Search documents' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Building your graph…');
  });

  it('keeps the building status while a second drop is parsing or linking', () => {
    useGraphStore.setState({ phase: 'parsing', graphUsable: true });
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    expect(screen.getByRole('status')).toHaveTextContent('Building your graph…');
    expect(screen.getByRole('button', { name: 'Search documents' })).toBeEnabled();

    act(() => useGraphStore.setState({ phase: 'linking' }));
    expect(screen.getByRole('status')).toHaveTextContent('Building your graph…');

    act(() => useGraphStore.setState({ phase: 'connecting' }));
    expect(screen.getByRole('status')).toHaveTextContent('Refining connections…');
  });
});
