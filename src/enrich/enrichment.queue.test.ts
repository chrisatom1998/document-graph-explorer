import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

const llm = vi.hoisted(() => ({ llmComplete: vi.fn(), llmStream: vi.fn() }));
const layout = vi.hoisted(() => ({
  layoutAddNodes: vi.fn(() => [] as string[]),
  layoutRemoveNodes: vi.fn(),
  layoutSetLinks: vi.fn(),
  layoutReheat: vi.fn(),
}));

vi.mock('../ai/llmClient', () => llm);
vi.mock('../layout/layoutBridge', () => layout);

import { useGraphStore } from '../store/graphStore';
import { clearRuntimeStores, textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { enqueueRun } from '../pipeline/runQueue';
import { askDocAi, runEnrichment } from './enrichment';
import * as textHydration from '../store/textHydration';

function doc(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'md',
    topics: ['local fallback'],
    topicsSource: 'tfidf',
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function ok(text: unknown) {
  return Promise.resolve({ ok: true as const, text: JSON.stringify(text) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('queued enrichment mutation', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    clearRuntimeStores();
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setEnrichProvider('openrouter');
    useSettingsStore.getState().setOpenRouterKey('test-key');
    llm.llmComplete.mockReset();
    layout.layoutAddNodes.mockClear();
    layout.layoutRemoveNodes.mockClear();
    layout.layoutSetLinks.mockClear();
    layout.layoutReheat.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useGraphStore.getState().reset();
    clearRuntimeStores();
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setOpenRouterKey('');
  });

  it('cleans up after hydration fails and permits a subsequent run', async () => {
    const node = doc('evicted');
    useGraphStore.getState().addNodes([node]);
    useGraphStore.getState().setPhase('ready');
    vi.spyOn(textHydration, 'getDocTexts')
      .mockRejectedValueOnce(new Error('IndexedDB read failed'));

    await expect(runEnrichment()).resolves.toEqual({
      ok: false,
      message: 'Enrichment failed: IndexedDB read failed',
    });
    expect(useGraphStore.getState()).toMatchObject({ phase: 'ready', enrichProgress: null });
    expect(llm.llmComplete).not.toHaveBeenCalled();

    textStore.set(node.id, 'document body');
    llm.llmComplete
      .mockResolvedValueOnce({ ok: true, text: JSON.stringify([
        { docId: node.id, summary: 'Summary', topics: ['privacy'] },
      ]) })
      .mockResolvedValueOnce({ ok: true, text: '[]' });
    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });
  });

  it('keeps document AI partial text alongside its interruption error', async () => {
    textStore.set('document', 'stored document body');
    llm.llmStream.mockResolvedValueOnce({
      ok: false,
      partialText: 'Partial summary',
      error: 'OpenRouter stream failed: generation failed',
    });

    await expect(askDocAi('document', 'Document', 'summarize')).resolves.toEqual({
      ok: false,
      text: 'Partial summary\n\nResponse interrupted: OpenRouter stream failed: generation failed',
    });
  });

  it('holds later graph mutations behind the shared FIFO queue', async () => {
    const node = doc('one');
    useGraphStore.getState().addNodes([node]);
    useGraphStore.getState().setPhase('ready');
    textStore.set(node.id, 'document body');
    const first = deferred<{ ok: true; text: string }>();
    llm.llmComplete
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(() => ok([{ cluster: 0, name: 'Named cluster' }]));

    const enrichment = runEnrichment();
    await vi.waitFor(() => expect(llm.llmComplete).toHaveBeenCalledTimes(1));
    let laterStarted = false;
    const later = enqueueRun(async () => {
      laterStarted = true;
    });
    await Promise.resolve();
    expect(laterStarted).toBe(false);

    first.resolve({
      ok: true,
      text: JSON.stringify([{ docId: 'one', summary: 'Summary', topics: ['privacy'] }]),
    });
    await expect(enrichment).resolves.toMatchObject({ ok: true });
    await later;
    expect(laterStarted).toBe(true);
  });

  it('discards a stale provider response and does not make a cleared graph ready', async () => {
    const node = doc('stale');
    useGraphStore.getState().addNodes([node]);
    useGraphStore.getState().setPhase('ready');
    textStore.set(node.id, 'document body');
    const first = deferred<{ ok: true; text: string }>();
    llm.llmComplete.mockReturnValueOnce(first.promise);

    const enrichment = runEnrichment();
    await vi.waitFor(() => expect(llm.llmComplete).toHaveBeenCalledTimes(1));
    useGraphStore.getState().reset();

    first.resolve({
      ok: true,
      text: JSON.stringify([{ docId: 'stale', summary: 'Too late', topics: ['stale'] }]),
    });
    await expect(enrichment).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/changed.*discarded/i),
    });
    expect(useGraphStore.getState()).toMatchObject({ nodes: [], phase: 'idle', clusterNames: {} });
  });

  it('rebuilds topic hubs and edges from enriched document topics', async () => {
    const docs = Array.from({ length: 6 }, (_, index) => doc(`doc-${index}`));
    useGraphStore.getState().addNodes(docs);
    useGraphStore.getState().setPhase('ready');
    for (const node of docs) textStore.set(node.id, `body ${node.id}`);

    llm.llmComplete
      .mockImplementationOnce(() =>
        ok(
          docs.map((node, index) => ({
            docId: node.id,
            summary: `Summary ${index}`,
            topics: index < 2 ? ['shared enriched topic'] : [`unique ${index}`],
          })),
        ),
      )
      .mockImplementationOnce(() => ok({ canon: [] }))
      .mockImplementationOnce(() => ok([{ cluster: 0, name: 'Enriched cluster' }]));

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const graph = useGraphStore.getState();
    expect(graph.nodes.find((node) => node.id === 'topic:shared enriched topic')).toMatchObject({
      kind: 'topic',
      degree: 2,
    });
    expect(
      graph.edges.filter(
        (edge) => edge.kind === 'topic' && edge.target === 'topic:shared enriched topic',
      ),
    ).toHaveLength(2);
    expect(layout.layoutSetLinks).toHaveBeenCalled();
  });
});
