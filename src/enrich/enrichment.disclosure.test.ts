import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_AI_MAX_CONTEXT_CHARS, ENRICH_BATCH_MAX_CHARS } from '../config';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import {
  enrichmentDocumentText,
  packEnrichmentBatches,
  runEnrichment,
} from './enrichment';

const documentNode: DocNode = {
  id: 'doc-1',
  kind: 'document',
  title: 'Private document',
  fileType: 'txt',
  topics: [],
  entities: [],
  keywords: [],
  wordCount: 2_000,
  cluster: 0,
  degree: 0,
  status: 'ok',
};

/** Every request streams, so responses are SSE (see ai/llmClient.ts). */
function completionResponse(text: string): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function parseDocumentsPayload(requestInit: RequestInit | undefined): { text: string }[] {
  const requestBody = JSON.parse(String(requestInit?.body)) as {
    messages: { role: string; content: string }[];
  };
  const prompt = requestBody.messages.find((m) => m.role === 'user')?.content ?? '';
  return JSON.parse(prompt.match(/Documents \(JSON\): (.+)$/m)?.[1] ?? 'null') as {
    text: string;
  }[];
}

describe('enrichment disclosure boundary', () => {
  beforeEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setEnrichProvider('openrouter');
    useSettingsStore.getState().setOpenRouterKey('test-key');
    useGraphStore.setState({ nodes: [documentNode], phase: 'ready' });
    textStore.set(documentNode.id, 'x'.repeat(9_000));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    textStore.clear();
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setOpenRouterKey('');
    useGraphStore.setState({ nodes: [], phase: 'idle' });
  });

  it('sends the full stored document body, not a 1,200-character stub', async () => {
    const body = 'x'.repeat(9_000);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        completionResponse(
          JSON.stringify([{ docId: documentNode.id, summary: 'Summary', topics: ['privacy'] }]),
        ),
      )
      .mockResolvedValueOnce(
        completionResponse(JSON.stringify([{ cluster: 0, name: 'Private Docs' }])),
      );

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const payload = parseDocumentsPayload(fetchMock.mock.calls[0]?.[1]);
    expect(payload[0].text).toHaveLength(9_000);
    expect(payload[0].text).toBe(body);
    expect(payload[0].text.length).toBeGreaterThan(1_200);
  });

  it('caps only an enormous file at DOCUMENT_AI_MAX_CONTEXT_CHARS', async () => {
    const body = 'y'.repeat(DOCUMENT_AI_MAX_CONTEXT_CHARS + 5_000);
    textStore.set(documentNode.id, body);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        completionResponse(
          JSON.stringify([{ docId: documentNode.id, summary: 'Summary', topics: ['privacy'] }]),
        ),
      )
      .mockResolvedValueOnce(
        completionResponse(JSON.stringify([{ cluster: 0, name: 'Private Docs' }])),
      );

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const payload = parseDocumentsPayload(fetchMock.mock.calls[0]?.[1]);
    expect(payload[0].text).toHaveLength(DOCUMENT_AI_MAX_CONTEXT_CHARS);
    expect(payload[0].text).toBe(body.slice(0, DOCUMENT_AI_MAX_CONTEXT_CHARS));
    expect(payload[0].text.length).toBeGreaterThan(1_200);
  });
});

describe('enrichmentDocumentText / packEnrichmentBatches', () => {
  afterEach(() => {
    textStore.clear();
  });

  it('returns the full stored body below the context ceiling', () => {
    const node = { ...documentNode, id: 'full' };
    const body = 'full document body '.repeat(200);
    textStore.set(node.id, body);
    expect(enrichmentDocumentText(node)).toBe(body);
    expect(body.length).toBeGreaterThan(1_200);
  });

  it('splits documents that would overflow the batch character budget', () => {
    const a: DocNode = { ...documentNode, id: 'a' };
    const b: DocNode = { ...documentNode, id: 'b' };
    textStore.set(a.id, 'a'.repeat(Math.floor(ENRICH_BATCH_MAX_CHARS * 0.6)));
    textStore.set(b.id, 'b'.repeat(Math.floor(ENRICH_BATCH_MAX_CHARS * 0.6)));
    expect(packEnrichmentBatches([a, b])).toEqual([[a], [b]]);
  });

  it('keeps small documents in one batch', () => {
    const a: DocNode = { ...documentNode, id: 'a' };
    const b: DocNode = { ...documentNode, id: 'b' };
    textStore.set(a.id, 'short a');
    textStore.set(b.id, 'short b');
    expect(packEnrichmentBatches([a, b])).toEqual([[a, b]]);
  });
});

describe('enrichment overwrite path (item 15)', () => {
  beforeEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setEnrichProvider('openrouter');
    useSettingsStore.getState().setOpenRouterKey('test-key');
    useGraphStore.setState({
      nodes: [
        {
          ...documentNode,
          summary: 'Local TextRank extractive summary of the document contents.',
          topics: ['rate limiting'],
          topicsSource: 'tfidf',
        },
      ],
      phase: 'ready',
    });
    textStore.set(documentNode.id, 'rate limiting rate limiting circuit breaker notes');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    textStore.clear();
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setOpenRouterKey('');
    useGraphStore.setState({ nodes: [], phase: 'idle' });
  });

  it('Gemini patch overwrites TextRank summary and stamps topicsSource gemini', async () => {
    const geminiSummary = 'Gemini-authored summary of the rate-limiting design.';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        completionResponse(
          JSON.stringify([
            { docId: documentNode.id, summary: geminiSummary, topics: ['rate limiting'] },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        completionResponse(JSON.stringify([{ cluster: 0, name: 'Rate Limits' }])),
      );

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const node = useGraphStore.getState().nodes.find((n) => n.id === documentNode.id);
    expect(node?.summary).toBe(geminiSummary);
    expect(node?.topicsSource).toBe('gemini');
    expect(node?.topics).toContain('rate limiting');
  });
});
