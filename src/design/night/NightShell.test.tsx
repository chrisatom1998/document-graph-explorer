// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import { layoutSetDims } from '../../layout/layoutBridge';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';

vi.mock('../../layout/layoutBridge', () => ({
  layoutSetDims: vi.fn(),
  layoutEpoch: () => 1,
  layoutSettledEpoch: () => 0,
  onLayoutSettled: () => () => undefined,
}));
vi.mock('../../ui/resonance/ResonanceFilters', () => ({ default: () => <aside>Filters</aside> }));
vi.mock('../../ui/resonance/ConnectedClips', () => ({ default: () => <aside>Connected documents</aside> }));
vi.mock('../../ui/resonance/CollabMenuItems', () => ({ default: () => null }));
vi.mock('../../ui/SnapshotDiffBanner', () => ({ default: () => null }));
vi.mock('../../ui/ExportImportMenu', () => ({ default: () => <div className="toolbar__menu glass-panel">Export contents</div> }));
vi.mock('../../ui/CorpusSwitcher', () => ({ default: () => <span>Corpus</span> }));
vi.mock('../../ui/SavedViewsSection', () => ({ default: () => null }));
vi.mock('../../ui/Minimap', () => ({ default: () => <div>Minimap</div> }));
vi.mock('../../ui/MusicAnalysisStatusButton', () => ({ default: () => null }));
vi.mock('../music/NowPlayingAudio', () => ({ default: () => null }));

import NightShell from './NightShell';

const doc = (id: string, title: string): DocNode => ({
  id, kind: 'document', title, fileType: 'txt', topics: [], entities: [], keywords: [],
  wordCount: 10, cluster: 0, degree: 0, status: 'ok',
});

/** The app's real stylesheets: Vitest drops CSS imports, so the cascade is loaded by hand. */
function loadStyles(): void {
  for (const file of ['src/styles.css', 'src/ui/GraphNavigator.css', 'src/ui/resonance/resonance.css', 'src/design/night/night.css']) {
    const style = document.createElement('style');
    style.dataset.test = 'night';
    style.textContent = readFileSync(resolve(process.cwd(), file), 'utf8');
    document.head.append(style);
  }
}

describe('NightShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.dataset.design = 'a';
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([doc('a', 'Alpha notes'), doc('b', 'Beta notes')]);
    useGraphStore.setState({ phase: 'ready', graphUsable: true });
    useUiStore.setState({ dims: 2 });
  });

  afterEach(() => {
    cleanup();
    document.querySelectorAll('style[data-test="night"]').forEach(s => s.remove());
    localStorage.removeItem('knowledge-nebula-dims');
  });

  it('labels the library shelves from the sounds it holds, as they arrive', () => {
    const clip = (path: string, seconds: number): DocNode => ({
      ...doc(path, path.replace(/^demo\/|\.wav$/g, '')), path, fileType: 'audio', wordCount: 0,
      audio: { version: 2, durationSeconds: seconds, analyzedSeconds: seconds, instruments: [], notes: [] } as unknown as DocNode['audio'],
    });
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([clip('demo/kick-one-shot.wav', 0.4)]);
    render(<NightShell graph={<div>Graph</div>} />);
    const shelves = () => within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map(b => b.textContent);

    // Only what this library has: no loops, no keys yet.
    expect(shelves()).toEqual(['All', 'One-shots', 'Drums', 'Kick']);
    const library = screen.getByRole('complementary', { name: 'Your library' });
    expect(within(library).getByText('Drums · One-shot')).toBeVisible();

    // A new upload with new properties adds its shelves.
    act(() => useGraphStore.getState().addNodes([clip('demo/pad-loop-Am-100.wav', 2.4)]));
    expect(shelves()).toEqual(expect.arrayContaining(['Loops', 'In key']));
    fireEvent.click(screen.getByRole('button', { name: 'Loops' }));
    expect(within(library).queryByRole('button', { name: /kick-one-shot/ })).not.toBeInTheDocument();
    expect(within(library).getByRole('button', { name: /pad-loop-Am-100/ })).toBeVisible();

    // If that property leaves the library, the shelf goes and the list falls back to All.
    act(() => { useGraphStore.getState().reset(); useGraphStore.getState().addNodes([clip('demo/kick-one-shot.wav', 0.4)]); });
    expect(shelves()).not.toContain('Loops');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(library).getByRole('button', { name: /kick-one-shot/ })).toBeVisible();
  });

  it('lets a library row pick a path endpoint or comparison slot instead of opening it', () => {
    render(<NightShell graph={<div>Graph</div>} />);
    const library = screen.getByRole('complementary', { name: 'Your library' });

    act(() => useUiStore.getState().setPathMode(true));
    fireEvent.click(within(library).getByRole('button', { name: /Alpha notes/ }));
    fireEvent.click(within(library).getByRole('button', { name: /Beta notes/ }));
    expect(useUiStore.getState().pathEndpoints).toEqual(['a', 'b']);
    expect(useUiStore.getState().selectedId).toBeNull();
    act(() => useUiStore.getState().setPathMode(false));

    act(() => useUiStore.setState({ compareLeftId: 'a', comparePick: 'right' }));
    fireEvent.click(within(library).getByRole('button', { name: /Beta notes/ }));
    expect(useUiStore.getState().compareRightId).toBe('b');
    expect(useUiStore.getState().comparePick).toBeNull();
  });

  it('puts a working 2D/3D switch on the sound map', () => {
    render(<NightShell graph={<div>Graph</div>} />);

    const map = screen.getByRole('region', { name: 'Sound Map' });
    fireEvent.click(within(map).getByRole('button', { name: 'Switch to 3D view' }));
    expect(useUiStore.getState().dims).toBe(3);
    expect(layoutSetDims).toHaveBeenLastCalledWith(3);

    fireEvent.click(within(map).getByRole('button', { name: 'Switch to 2D view' }));
    expect(useUiStore.getState().dims).toBe(2);
    expect(layoutSetDims).toHaveBeenLastCalledWith(2);
    // One switch only: the header no longer carries a second copy.
    expect(screen.getAllByRole('button', { name: /^Switch to [23]D view$/ })).toHaveLength(1);
  });

  it('lists the library as rows in the sidebar', () => {
    render(<NightShell graph={<div>Graph</div>} />);

    const library = screen.getByRole('complementary', { name: 'Your library' });
    expect(within(library).getByRole('heading', { name: 'Your Library' })).toBeVisible();
    fireEvent.click(within(library).getByRole('button', { name: /Beta notes/ }));
    expect(useUiStore.getState().selectedId).toBe('b');
  });

  it('shows the searchable document list in the Library view', async () => {
    loadStyles();
    render(<NightShell graph={<div>Graph</div>} />);

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    const browse = document.querySelector<HTMLElement>('.ns-browse')!;
    const option = await within(browse).findByRole('option', { name: /Alpha notes/ });
    const navigator = option.closest<HTMLElement>('.graph-navigator');
    expect(navigator).toHaveClass('graph-navigator--embedded');
    // The shared navigator is a hidden fixed popover unless the library column overrides it.
    const style = getComputedStyle(navigator!);
    expect(style.position).toBe('static');
    expect(style.opacity).toBe('1');
    expect(style.pointerEvents).toBe('auto');
    expect(style.transform).toBe('none');
    expect(option).toBeVisible();
  });

  it('lays the export menu out in the panel instead of as a dropdown', async () => {
    loadStyles();
    render(<NightShell graph={<div>Graph</div>} />);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const menu = (await screen.findByText('Export contents'));
    expect(menu.closest('.ns-export')).not.toBeNull();
    expect(getComputedStyle(menu).position).toBe('static');
  });
});
