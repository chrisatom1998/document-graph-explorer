// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { docVectorStore, textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import ComparePanel from './ComparePanel';

function doc(id: string, title: string, extra: Partial<DocNode> = {}): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'txt',
    topics: extra.topics ?? [],
    entities: extra.entities ?? [],
    keywords: extra.keywords ?? [],
    wordCount: 20,
    cluster: 0,
    degree: 1,
    status: 'ok',
    ...extra,
  };
}

const edge: Edge = {
  id: 'alpha->beta:semantic',
  source: 'alpha',
  target: 'beta',
  kind: 'semantic',
  weight: 0.81,
  evidence: ['shared passage about rate limits'],
};

describe('ComparePanel', () => {
  beforeEach(() => {
    textStore.clear();
    docVectorStore.clear();
    textStore.set('alpha', 'Alpha discusses rate limits and quotas.');
    textStore.set('beta', 'Beta also covers rate limits in production.');
    const nodes = [
      doc('alpha', 'Alpha Runbook', { topics: ['Incidents'], keywords: ['quota'] }),
      doc('beta', 'Beta Policy', { topics: ['incidents'], keywords: ['quota'] }),
    ];
    useGraphStore.setState({
      nodes,
      nodeIndex: { alpha: 0, beta: 1 },
      edges: [edge],
    });
    useUiStore.setState({
      compareLeftId: 'alpha',
      compareRightId: 'beta',
      comparePick: null,
      selectedId: null,
    });
  });

  afterEach(() => {
    cleanup();
    textStore.clear();
    docVectorStore.clear();
    useUiStore.getState().clearCompare();
  });

  it('renders both titles, the relationship strip, and both readers', () => {
    render(<ComparePanel />);
    expect(screen.getByRole('dialog', { name: 'Compare documents' })).toBeInTheDocument();
    expect(screen.getAllByText('Alpha Runbook').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta Policy').length).toBeGreaterThan(0);
    expect(screen.getByText(/similar · 81%/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /topic · incidents/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'quota' })).toBeInTheDocument();
    expect(screen.getByText('shared passage about rate limits')).toBeInTheDocument();
    expect(screen.getByText('Alpha discusses rate limits and quotas.')).toBeInTheDocument();
    expect(screen.getByText('Beta also covers rate limits in production.')).toBeInTheDocument();
  });

  it('swaps panes and closes', () => {
    render(<ComparePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Swap left and right' }));
    expect(useUiStore.getState().compareLeftId).toBe('beta');
    expect(useUiStore.getState().compareRightId).toBe('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Close compare' }));
    expect(useUiStore.getState().compareLeftId).toBeNull();
    expect(useUiStore.getState().compareRightId).toBeNull();
  });

  it('highlights a shared term in both readers', () => {
    render(<ComparePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'quota' }));
    expect(screen.getAllByRole('status').some((el) => /matching passage/i.test(el.textContent ?? ''))).toBe(
      true,
    );
  });

  it('refreshes similarity after vectors arrive', () => {
    render(<ComparePanel />);
    expect(screen.queryByText(/100% similar/i)).not.toBeInTheDocument();

    act(() => {
      docVectorStore.set('alpha', new Float32Array([1, 0]));
      docVectorStore.set('beta', new Float32Array([1, 0]));
      // Vector storage is intentionally non-reactive; the next ordinary panel
      // render must still observe the newly available vector identities.
      useUiStore.setState({ comparePick: 'left' });
    });

    expect(screen.getByText(/100% similar/i)).toBeInTheDocument();
  });

  it('closes on Escape before other panels', () => {
    render(<ComparePanel />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().compareLeftId).toBeNull();
    expect(useUiStore.getState().compareRightId).toBeNull();
  });

  it('shows a pick banner before the second document is chosen', () => {
    useUiStore.setState({
      compareLeftId: 'alpha',
      compareRightId: null,
      comparePick: 'right',
    });
    render(<ComparePanel />);
    expect(screen.getByRole('status', { name: 'Compare documents' })).toBeInTheDocument();
    expect(screen.getByText('Click another document to compare.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Compare documents' })).not.toBeInTheDocument();
  });

  it('shows an empty-text fallback when a reader has no cached body', () => {
    textStore.delete('beta');
    render(<ComparePanel />);
    expect(screen.getByText('text unavailable')).toBeInTheDocument();
  });
});
