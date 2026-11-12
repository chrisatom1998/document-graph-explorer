// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('shows the embedded document list inside the library column', async () => {
    loadStyles();
    render(<NightShell graph={<div>Graph</div>} />);

    const library = screen.getByRole('complementary', { name: 'Your library' });
    const option = await within(library).findByRole('option', { name: /Alpha notes/ });
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
