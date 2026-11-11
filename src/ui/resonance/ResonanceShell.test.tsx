// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../Minimap', () => ({ default: () => <div>Minimap</div> }));
vi.mock('../clearLoadedData', () => ({
  clearLoadedData: vi.fn(async () => true),
}));

import ResonanceShell from './ResonanceShell';
import { clearLoadedData } from '../clearLoadedData';
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

  it('keeps Reset graph disabled until there is a graph', () => {
    useGraphStore.getState().reset();
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    expect(screen.getByRole('menuitem', { name: 'Reset graph' })).toBeDisabled();
  });

  it('resets the graph from the More menu after confirmation', async () => {
    vi.mocked(clearLoadedData).mockImplementation(async () => {
      useGraphStore.getState().reset();
      return true;
    });
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset graph' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Reset graph?' });
    expect(dialog).toHaveTextContent('API keys and settings stay');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(clearLoadedData).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Reset graph?' })).not.toBeInTheDocument();
    expect(document.querySelector('.rs-root')).not.toHaveClass('rs-root--empty');

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset graph' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(clearLoadedData).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Reset graph?' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset graph' }));
    await waitFor(() => {
      expect(document.querySelector('.rs-root')).toHaveClass('rs-root--empty');
      expect(screen.queryByRole('dialog', { name: 'Reset graph?' })).not.toBeInTheDocument();
      expect(useUiStore.getState().toasts.at(-1)).toMatchObject({ message: 'Graph reset.', kind: 'info' });
    });
    expect(screen.queryByText('Filters')).not.toBeInTheDocument();
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
