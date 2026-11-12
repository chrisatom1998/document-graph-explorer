// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';

vi.mock('./ResonanceFilters', () => ({ default: () => <aside>Filters</aside> }));
vi.mock('./ConnectedClips', () => ({ default: () => <aside>Connected documents</aside> }));
vi.mock('./CollabMenuItems', () => ({ default: () => null }));
vi.mock('../SnapshotDiffBanner', () => ({ default: () => null }));
vi.mock('../DimsToggleButton', () => ({
  DimsToggleButton: () => <button type="button">Switch to 2D view</button>,
}));
vi.mock('../GraphNavigator', () => ({ default: () => <div>Library contents</div> }));
vi.mock('../ExportImportMenu', () => ({ default: () => <div>Export contents</div> }));
vi.mock('../CorpusSwitcher', () => ({ default: () => <span>Corpus</span> }));
vi.mock('../SavedViewsSection', () => ({ default: () => null }));
vi.mock('../Minimap', () => ({ default: () => <div>Minimap</div> }));

import ResonanceShell from './ResonanceShell';
import { useMusicJobs } from '../../store/musicJobs';

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

describe('ResonanceShell stage controls', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([documentNode]);
    useGraphStore.setState({ phase: 'ready', graphUsable: true });
    useUiStore.setState({ searchOpen: false, pathMode: false, cameraCommand: null });
    useMusicJobs.setState({ jobs: {}, minimized: false });
  });

  afterEach(() => {
    cleanup();
    useMusicJobs.setState({ jobs: {}, minimized: false });
  });

  it('fits the graph from the top bar and the More menu, like the Home key', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    const fit = screen.getByRole('button', { name: 'Fit graph to view' });
    expect(fit).toHaveAttribute('title', expect.stringContaining('Home'));
    fireEvent.click(fit);
    expect(useUiStore.getState().cameraCommand).toMatchObject({ kind: 'fitAll' });

    act(() => useUiStore.setState({ cameraCommand: null }));
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    const item = screen.getByRole('menuitem', { name: 'Fit graph' });
    expect(item).toHaveAttribute('title', expect.stringContaining('Home'));
    fireEvent.click(item);
    expect(useUiStore.getState().cameraCommand).toMatchObject({ kind: 'fitAll' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables Fit graph until there is a graph to fit', () => {
    useGraphStore.getState().reset();
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    expect(screen.getByRole('button', { name: 'Fit graph to view' })).toBeDisabled();
  });

  it('keeps the graph canvas mounted behind the empty welcome screen', () => {
    useGraphStore.getState().reset();
    render(<ResonanceShell><div>Graph canvas</div></ResonanceShell>);

    expect(screen.getByRole('heading', { name: /Your sounds, mapped by how they sound/ })).toBeVisible();
    expect(document.querySelector('.mx-map__slot')).toContainHTML('Graph canvas');
  });

  it('puts the 2D/3D switch on the sound map', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    const map = screen.getByRole('region', { name: 'Sound Map' });
    expect(within(map).getByRole('button', { name: 'Switch to 2D view' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Switch to 2D view' })).toHaveLength(1);
    expect(document.querySelector('.rs-top__actions')?.textContent).not.toContain('Switch to 2D view');
  });

  it('keeps the library list and the export actions in the Night Session panels', async () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    const library = document.querySelector('.ns-library');
    expect(library).not.toBeNull();
    expect(await within(library as HTMLElement).findByText('Library contents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const exportPanel = document.querySelector('.ns-export');
    expect(exportPanel).not.toBeNull();
    expect(await within(exportPanel as HTMLElement).findByText('Export contents')).toBeInTheDocument();
  });

  it('mounts the minimap inside the graph stage and lets the Library view cover it', async () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    const stage = screen.getByRole('main', { name: 'Graph' });
    expect(await within(stage).findByText('Minimap')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.queryByText('Minimap')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(await within(stage).findByText('Minimap')).toBeInTheDocument();
  });

  it('offers a restore control only while the audio-analysis notice is minimized', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    expect(screen.queryByRole('button', { name: 'Show audio analysis details' })).not.toBeInTheDocument();

    act(() => useMusicJobs.setState({ jobs: { clip: 'Preparing audio' }, minimized: false }));
    expect(screen.queryByRole('button', { name: 'Show audio analysis details' })).not.toBeInTheDocument();

    act(() => useMusicJobs.setState({ minimized: true }));
    const restore = screen.getByRole('button', { name: 'Show audio analysis details' });
    expect(restore).toHaveClass('rs-icon');
    expect(restore.closest('.rs-top__actions')).not.toBeNull();
    fireEvent.click(restore);
    expect(useMusicJobs.getState().minimized).toBe(false);
    expect(screen.queryByRole('button', { name: 'Show audio analysis details' })).not.toBeInTheDocument();
  });
});
