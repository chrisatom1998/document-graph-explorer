// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanelHeader from './SidePanelHeader';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const unit = (hot: number[]) => { const v = new Array(512).fill(0); hot.forEach((i, k) => { v[i] = 1 - k * .01; }); const n = Math.hypot(...v); return v.map(x => x / n); };
const clip = (id: string, embedding?: number[]): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [], ...(embedding ? { embedding } : {}) },
});

function show(node: DocNode, nodes: DocNode[]) {
  useGraphStore.setState({ nodes, nodeIndex: Object.fromEntries(nodes.map((n, i) => [n.id, i])), edges: [], clusterNames: {}, localClusterNames: {} });
  render(<SidePanelHeader node={node} codeLang={null} confirmRemove={false} onArmRemove={() => {}} onCancelRemove={() => {}} closeButtonRef={createRef()} />);
}

describe('More like this on a clip', () => {
  afterEach(() => { cleanup(); useUiStore.setState({ searchResults: null, highlightOwner: null, toasts: [] }); useGraphStore.getState().reset(); });

  it('highlights clips with a close sound fingerprint and offers no text Compare', () => {
    const a = clip('a', unit([1, 2, 3])), b = clip('b', unit([1, 2, 3, 4])), c = clip('c', unit([300, 301, 302]));
    show(a, [a, b, c]);
    expect(screen.queryByRole('button', { name: /^compare$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /more like this/i }));
    expect(useUiStore.getState().searchResults).toEqual(['a', 'b']);
    expect(useUiStore.getState().highlightOwner).toBe('showMe');
  });

  it('says so when no clip clears the sound-alike floor', () => {
    const a = clip('a', unit([1, 2, 3])), c = clip('c', unit([300, 301, 302]));
    show(a, [a, c]);
    fireEvent.click(screen.getByRole('button', { name: /more like this/i }));
    expect(useUiStore.getState().searchResults).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/No clips in this library sound close enough/);
  });

  it('says so when the clip has no fingerprint yet', () => {
    const a = clip('a');
    show(a, [a, clip('b', unit([1]))]);
    fireEvent.click(screen.getByRole('button', { name: /more like this/i }));
    expect(useUiStore.getState().searchResults).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/no sound fingerprint yet/);
  });
});
