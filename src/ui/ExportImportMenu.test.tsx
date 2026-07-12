// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocNode, Edge } from '../model/types';

vi.mock('../persistence/exportImport', () => ({
  exportGraphJSON: vi.fn(() => Promise.resolve()),
  exportScenePNG: vi.fn(() => Promise.resolve(true)),
  importGraphJSONFile: vi.fn(() =>
    Promise.resolve({
      nodes: [
        {
          id: 'imported',
          kind: 'document',
          title: 'Doc imported',
          fileType: 'md',
          topics: [],
          entities: [],
          keywords: [],
          wordCount: 20,
          cluster: 0,
          degree: 0,
          status: 'ok',
        },
      ],
      edges: [] as Edge[],
    }),
  ),
}));

import ExportImportMenu from './ExportImportMenu';
import { importGraphJSONFile } from '../persistence/exportImport';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const mockImportGraphJSONFile = vi.mocked(importGraphJSONFile);

function docNode(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: `Doc ${id}`,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function edge(source = 'a', target = 'b'): Edge {
  return {
    id: `${source}->${target}:semantic`,
    source,
    target,
    kind: 'semantic',
    weight: 0.8,
    evidence: ['similar text'],
  };
}

function setGraph(nodes: DocNode[], phase: 'idle' | 'parsing' | 'ready' = 'ready'): void {
  const nodeIndex: Record<string, number> = {};
  nodes.forEach((node, index) => {
    nodeIndex[node.id] = index;
  });
  useGraphStore.setState({
    nodes,
    nodeIndex,
    edges: nodes.length > 1 ? [edge(nodes[0].id, nodes[1].id)] : [],
    phase,
    clusterNames: {},
    localClusterNames: {},
  });
}

function pickJsonFile(name = 'graph.json'): File {
  const file = new File(['{"version":1}'], name, { type: 'application/json' });
  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"][accept=".json,application/json"]',
  );
  if (!input) throw new Error('missing graph JSON input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return file;
}

describe('ExportImportMenu', () => {
  beforeEach(() => {
    mockImportGraphJSONFile.mockResolvedValue({ nodes: [docNode('imported')], edges: [] });
    useGraphStore.getState().reset();
    useUiStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('confirms before importing over an existing graph', async () => {
    setGraph([docNode('a')], 'ready');
    render(<ExportImportMenu />);

    fireEvent.click(screen.getByRole('button', { name: /import graph json/i }));
    const file = pickJsonFile();

    const dialog = await screen.findByRole('dialog', { name: /replace current graph/i });
    expect(dialog).toBeVisible();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByText(file.name)).toBeInTheDocument();
    expect(mockImportGraphJSONFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^import graph$/i }));

    await waitFor(() => expect(mockImportGraphJSONFile).toHaveBeenCalledWith(file));
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/imported 1 document/i);
  });

  it('imports immediately when the graph is empty', async () => {
    setGraph([], 'idle');
    render(<ExportImportMenu />);

    fireEvent.click(screen.getByRole('button', { name: /import graph json/i }));
    const file = pickJsonFile();

    await waitFor(() => expect(mockImportGraphJSONFile).toHaveBeenCalledWith(file));
    expect(screen.queryByRole('dialog', { name: /replace current graph/i })).not.toBeInTheDocument();
  });

  it('reports document and topic-node counts separately', async () => {
    mockImportGraphJSONFile.mockResolvedValueOnce({
      nodes: [docNode('imported'), { ...docNode('topic'), kind: 'topic', fileType: 'other' }],
      edges: [edge('imported', 'topic')],
    });
    setGraph([], 'idle');
    render(<ExportImportMenu />);

    fireEvent.click(screen.getByRole('button', { name: /import graph json/i }));
    pickJsonFile();

    await waitFor(() =>
      expect(useUiStore.getState().toasts.at(-1)?.message).toBe(
        'Imported 1 document, 1 topic node, and 1 connection.',
      ),
    );
  });

  it('cancel leaves the pending import untouched', async () => {
    setGraph([docNode('a')], 'ready');
    render(<ExportImportMenu />);

    fireEvent.click(screen.getByRole('button', { name: /import graph json/i }));
    pickJsonFile();
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(mockImportGraphJSONFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /replace current graph/i })).not.toBeInTheDocument();
  });

  it('disables import while the pipeline is processing', () => {
    setGraph([docNode('a')], 'parsing');

    render(<ExportImportMenu />);

    expect(screen.getByRole('button', { name: /import graph json/i })).toBeDisabled();
  });

  it('surfaces import failures as toasts', async () => {
    mockImportGraphJSONFile.mockRejectedValueOnce(
      new Error('Import failed: file is not valid JSON.'),
    );
    setGraph([], 'idle');
    render(<ExportImportMenu />);

    fireEvent.click(screen.getByRole('button', { name: /import graph json/i }));
    pickJsonFile('bad.json');

    await waitFor(() =>
      expect(useUiStore.getState().toasts.at(-1)?.message).toBe(
        'Import failed: file is not valid JSON.',
      ),
    );
  });
});
