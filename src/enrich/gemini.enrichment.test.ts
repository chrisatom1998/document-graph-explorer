import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { runEnrichment } from './gemini';

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

function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Gemini enrichment disclosure boundary', () => {
  beforeEach(() => {
    useSettingsStore.getState().setOfflineMode(false);
    useSettingsStore.getState().setEnrichEnabled(true);
    useSettingsStore.getState().setGeminiKey('test-key');
    useGraphStore.setState({ nodes: [documentNode], phase: 'ready' });
    textStore.set(documentNode.id, 'x'.repeat(9_000));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    textStore.clear();
    useSettingsStore.getState().setEnrichEnabled(false);
    useSettingsStore.getState().setGeminiKey('');
    useGraphStore.setState({ nodes: [], phase: 'idle' });
  });

  it('sends no more than the disclosed 1,200 characters per document', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        geminiResponse(
          JSON.stringify([
            { docId: documentNode.id, summary: 'Summary', topics: ['privacy'] },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        geminiResponse(JSON.stringify([{ cluster: 0, name: 'Private Docs' }])),
      );

    await expect(runEnrichment()).resolves.toMatchObject({ ok: true });

    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const requestBody = JSON.parse(String(firstRequest?.body)) as {
      contents: { parts: { text: string }[] }[];
    };
    const prompt = requestBody.contents[0].parts[0].text;
    const payload = JSON.parse(prompt.match(/Documents \(JSON\): (.+)$/m)?.[1] ?? 'null') as {
      excerpt: string;
    }[];
    expect(payload[0].excerpt).toHaveLength(1_200);
    expect(payload[0].excerpt).toBe('x'.repeat(1_200));
  });
});
