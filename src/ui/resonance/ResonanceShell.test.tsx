// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useViewStore } from '../../store/viewStore';

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
vi.mock('./ForYou', () => ({ default: () => <section>For you contents</section> }));
vi.mock('./Transport', () => ({ default: () => <footer>Transport</footer> }));
vi.mock('../../ingest/folderPicker', () => ({ openFolderPicker: vi.fn() }));

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
    useViewStore.setState({ tab: 'graph' });
  });

  afterEach(cleanup);

  it('enables read-only discovery tools while final graph actions stay gated', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    expect(screen.getByRole('status')).toHaveTextContent('Refining connections…');
    const search = screen.getByRole('button', { name: /^Search documents/ });
    expect(search).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('button', { name: 'Library' })).toBeEnabled();

    fireEvent.click(search);
    expect(useUiStore.getState().searchOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    expect(screen.getByRole('menuitem', { name: /find a path/i })).toBeDisabled();

    act(() => useGraphStore.setState({ graphUsable: false }));
    expect(screen.getByRole('button', { name: /^Search documents/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Building your graph…');
  });

  it('keeps the building status while a second drop is parsing or linking', () => {
    useGraphStore.setState({ phase: 'parsing', graphUsable: true });
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);

    expect(screen.getByRole('status')).toHaveTextContent('Building your graph…');
    expect(screen.getByRole('button', { name: /^Search documents/ })).toHaveAttribute('aria-disabled', 'false');

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
    useViewStore.setState({ tab: 'graph' });
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

describe('ResonanceShell For you view', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useUiStore.setState({ searchOpen: false });
    useViewStore.setState({ tab: 'foryou' });
  });
  afterEach(cleanup);

  it('lists the four views with For you current, and keeps the player and folder action on screen', async () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['For you', 'Graph', 'Library', 'Export']);
    expect(within(nav).getByRole('button', { name: 'For you' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('For you contents')).toBeInTheDocument();
    expect(await screen.findByText('Transport')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a folder' })).toBeInTheDocument();
    expect(screen.queryByText('Filters')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected documents')).not.toBeInTheDocument();
  });

  it('opens the folder picker from the top-bar pill', async () => {
    const { openFolderPicker } = await import('../../ingest/folderPicker');
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Add a folder' }));
    expect(openFolderPicker).toHaveBeenCalledTimes(1);
  });

  it('does not open search before there is anything to search', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    fireEvent.click(screen.getByRole('button', { name: /^Search documents/ }));
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('names the folder button even where its text is hidden', () => {
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    expect(screen.getByRole('button', { name: 'Add a folder' })).toHaveAttribute('aria-label', 'Add a folder');
  });

  it.each([
    ['a search result or chat citation starting a focus', () => useUiStore.setState({ pendingFocus: { id: 'doc' } as never })],
    ['an insights jump highlighting documents', () => useUiStore.getState().setSearchResults(['doc'], 'insights')],
    ['a path highlight', () => useUiStore.getState().setSearchResults(['doc'], 'path')],
  ])('brings the Graph forward when %s navigates from For you', (_name, run) => {
    useGraphStore.getState().addNodes([documentNode]);
    useGraphStore.setState({ phase: 'ready', graphUsable: true });
    useUiStore.setState({ pendingFocus: null, selectedId: null, searchResults: null, highlightOwner: null });
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    expect(useViewStore.getState().tab).toBe('foryou');
    act(() => run());
    expect(useViewStore.getState().tab).toBe('graph');
  });

  it('does not leave For you for the search overlay\'s own live highlight', () => {
    useGraphStore.getState().addNodes([documentNode]);
    useGraphStore.setState({ phase: 'ready', graphUsable: true });
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    act(() => useUiStore.getState().setSearchResults(['doc'], 'search'));
    expect(useViewStore.getState().tab).toBe('foryou');
  });

  it('switching to Graph shows the filters and the canvas instead of For you', () => {
    useGraphStore.getState().addNodes([documentNode]);
    useGraphStore.setState({ phase: 'ready', graphUsable: true });
    render(<ResonanceShell><div>Graph</div></ResonanceShell>);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Views' })).getByRole('button', { name: 'Graph' }));
    expect(screen.queryByText('For you contents')).not.toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });
});
