// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { commitPendingFocus, focusNode } from './focusNode';

function doc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('SidePanel passage fly-to and similar docs', () => {
  beforeEach(() => {
    textStore.clear();
    textStore.set('doc1', 'The disaster recovery procedure is tested quarterly.');
    const nodes = [doc('doc1', 'Doc One')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { doc1: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.setState({
      selectedId: 'doc1',
      readerHighlight: {
        docId: 'doc1',
        text: 'disaster recovery procedure is tested quarterly',
        passageIndex: 0,
      },
      toasts: [],
    });
  });

  afterEach(() => {
    cleanup();
    textStore.clear();
    useUiStore.setState({ selectedId: null, readerHighlight: null });
    useSettingsStore.setState({ enrichEnabled: false, enrichProvider: 'openrouter' });
  });

  it('shows the matching passage banner and highlights it in the reader', () => {
    render(<SidePanel />);
    expect(screen.getByRole('status')).toHaveTextContent(/matching passage/i);
    expect(screen.getByRole('status')).toHaveTextContent(/disaster recovery/i);
    expect(document.querySelector('mark.passage-mark')?.textContent).toMatch(/disaster recovery/i);
    expect(screen.getByText('No summary available yet.')).not.toBeVisible();
  });

  it('offers More like this without adding toolbar chrome', () => {
    render(<SidePanel />);
    expect(screen.getByRole('button', { name: /more like this/i })).toBeInTheDocument();
  });

  function expectSections(expanded: boolean): void {
    const value = expanded ? 'true' : 'false';
    expect(screen.getByRole('button', { name: /^about$/i })).toHaveAttribute('aria-expanded', value);
    expect(screen.getByRole('button', { name: /^connections$/i })).toHaveAttribute(
      'aria-expanded',
      value,
    );
  }

  function expandSections(): void {
    fireEvent.click(screen.getByRole('button', { name: /^about$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^connections$/i }));
    expectSections(true);
  }

  it('collapses About and Connections when a passage fly-to hits the open document', () => {
    render(<SidePanel />);
    expandSections();

    act(() => {
      focusNode('doc1', { text: 'tested quarterly' });
      commitPendingFocus();
    });

    expectSections(false);
  });

  it('collapses sections on a same-document search fly-to after a graph click', () => {
    useUiStore.setState({ selectedId: 'doc1', readerHighlight: null });
    render(<SidePanel />);
    expandSections();

    act(() => {
      focusNode('doc1', { index: 0, text: 'disaster recovery procedure is tested quarterly' });
      commitPendingFocus();
    });

    expect(useUiStore.getState().selectedId).toBe('doc1');
    expect(useUiStore.getState().readerHighlight).toMatchObject({
      docId: 'doc1',
      text: 'disaster recovery procedure is tested quarterly',
    });
    expectSections(false);

    expandSections();
    act(() => {
      focusNode('doc1', { text: 'tested quarterly' });
      commitPendingFocus();
    });
    expectSections(false);
  });

  it('keeps disclosures adjacent to the reader in document mode', () => {
    render(<SidePanel />);
    const aboutSection = screen.getByRole('button', { name: /^about$/i }).closest('.side-panel__section');
    const connectionsSection = screen
      .getByRole('button', { name: /^connections$/i })
      .closest('.side-panel__section');
    expect(aboutSection).toHaveClass('side-panel__section--compact');
    expect(connectionsSection).toHaveClass('side-panel__section--compact');
  });
});
