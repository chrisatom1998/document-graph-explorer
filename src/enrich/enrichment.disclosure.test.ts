import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { runEnrichment } from './enrichment';

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

  it('sends no more than the disclosed 1,200 characters per document', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        completionResponse(
          JSON.stringify([
            { docId: documentNode.id, summary: 'Summary', topics: ['privacy'] },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        completionResponse(JSON.stringify([{ cluster: 0, name: 'Private Docs' }])),
      );

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const requestBody = JSON.parse(String(firstRequest?.body)) as {
      messages: { role: string; content: string }[];
    };
    const prompt = requestBody.messages.find((m) => m.role === 'user')?.content ?? '';
    const payload = JSON.parse(prompt.match(/Documents \(JSON\): (.+)$/m)?.[1] ?? 'null') as {
      excerpt: string;
    }[];
    expect(payload[0].excerpt).toHaveLength(1_200);
    expect(payload[0].excerpt).toBe('x'.repeat(1_200));
  });
});

describe("enrichment overwrite path (item 15)", () => {
  beforeEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setEnrichProvider("openrouter");
    useSettingsStore.getState().setOpenRouterKey("test-key");
    useGraphStore.setState({
      nodes: [
        {
          ...documentNode,
          summary: "Local TextRank extractive summary of the document contents.",
          topics: ["rate limiting"],
          topicsSource: "tfidf",
        },
      ],
      phase: "ready",
    });
    textStore.set(documentNode.id, "rate limiting rate limiting circuit breaker notes");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    textStore.clear();
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setOpenRouterKey("");
    useGraphStore.setState({ nodes: [], phase: "idle" });
  });

  it("Gemini patch overwrites TextRank summary and stamps topicsSource gemini", async () => {
    const geminiSummary = "Gemini-authored summary of the rate-limiting design.";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        completionResponse(
          JSON.stringify([
            { docId: documentNode.id, summary: geminiSummary, topics: ["rate limiting"] },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        completionResponse(JSON.stringify([{ cluster: 0, name: "Rate Limits" }])),
      );

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const node = useGraphStore.getState().nodes.find((n) => n.id === documentNode.id);
    expect(node?.summary).toBe(geminiSummary);
    expect(node?.topicsSource).toBe("gemini");
    expect(node?.topics).toContain("rate limiting");
  });
});
