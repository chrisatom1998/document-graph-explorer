// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

const dbState = vi.hoisted(() => ({
  docs: new Map<string, { hash: string; text: string; chunkTexts: string[] }>(),
}));
vi.mock('../persistence/db', () => {
  const get = async (id: string) => dbState.docs.get(id);
  return {
    getDb: async () => ({
      get: (_store: string, id: string) => get(id),
      transaction: () => ({ objectStore: () => ({ get } as { get: typeof get }) }),
    }),
  };
});

import { clearRuntimeStores, textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { markDocsPersisted } from '../store/textHydration';
import SidePanelReader from './SidePanelReader';

function doc(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
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

function renderReader(node: DocNode) {
  // The reader only ever renders a doc the graph holds, and hydration caches
  // a fetched body back only for docs still in the corpus.
  useGraphStore.setState({ nodes: [node], nodeIndex: { [node.id]: 0 } });
  return render(
    <SidePanelReader
      node={node}
      nodes={[node]}
      readerHighlight={null}
      readerLabel="Plain text"
      codeLang={null}
    />,
  );
}

describe('SidePanelReader hydration on an evicted body', () => {
  beforeEach(() => {
    clearRuntimeStores();
    dbState.docs.clear();
  });

  afterEach(() => {
    cleanup();
    clearRuntimeStores();
  });

  it('shows a loading state, then the rehydrated text — never a flash of "text unavailable"', async () => {
    dbState.docs.set('doc1', {
      hash: 'doc1',
      text: 'Hydrated disaster recovery body.',
      chunkTexts: [],
    });
    markDocsPersisted(['doc1']); // evicted but persisted

    renderReader(doc('doc1'));

    expect(screen.getByText(/loading text/i)).toBeInTheDocument();
    expect(screen.queryByText(/text unavailable/i)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText(/hydrated disaster recovery body/i)).toBeInTheDocument(),
    );
    expect(textStore.get('doc1')).toBe('Hydrated disaster recovery body.');
  });

  it('shows "text unavailable" only on a confirmed miss', () => {
    renderReader(doc('doc2')); // no resident text, no persisted record

    expect(screen.getByText(/text unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading text/i)).not.toBeInTheDocument();
  });
});
