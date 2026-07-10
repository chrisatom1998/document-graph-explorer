/**
 * Optional Layer-3 enrichment via Google's Gemini API (spec §5.3).
 *
 * Three sequential passes:
 *   1. Batched summaries + topics per doc (strict JSON via responseSchema)
 *   2. Corpus-wide topic canonicalization ("auth"/"authentication"/"AuthN" -> one)
 *   3. Cluster naming ("Deployment & Infra")
 *
 * Every failure path degrades gracefully — the graph is complete without
 * enrichment. runEnrichment never throws and never leaves the phase stuck.
 */

import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';
import {
  geminiSystemInstruction,
  geminiThinkingConfig,
  resolveGeminiModel,
} from '../ai/geminiModels';
import {
  ENRICH_BATCH_SIZE,
  ENRICH_MAX_RETRIES,
  GEMINI_ENDPOINT,
} from '../config';
import type { DocNode } from '../model/types';
import { isOffline, OFFLINE_MESSAGE } from '../offline';
import { useGraphStore } from '../store/graphStore';
import { textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { prepareDocumentContext } from './documentContext';

const EXCERPT_CHARS = 8_000; // per-doc in batched enrichment (15 docs × 8k ≈ 120k chars, well within context)
const CLUSTER_TITLES_CAP = 30;
const TOPICS_PER_DOC = 5;

// ---------------------------------------------------------------------------
// Low-level call with retry (429/503/network -> 1s/2s/4s backoff)
// ---------------------------------------------------------------------------

type CallResult = { ok: true; text: string } | { ok: false; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractText(data: unknown): string | null {
  const d = data as {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
  } | null;
  const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof t === 'string' ? t : null;
}

export function parseModelJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through — some models wrap JSON in fences despite the mime type */
  }
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return null;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

async function callGemini(prompt: string, responseSchema: unknown): Promise<CallResult> {
  if (isOffline()) return { ok: false, error: AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE };
  const { geminiKey } = useSettingsStore.getState();
  const model = resolveGeminiModel('enrichment');
  // Key travels as a header, not a query param: URLs leak into proxy/server
  // logs and browser history; headers don't.
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: geminiSystemInstruction('enrichment'),
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      ...geminiThinkingConfig('enrichment', model),
    },
  });

  let lastError = 'Unknown Gemini error';
  for (let attempt = 0; ; attempt++) {
    let retryable = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Trim: a pasted key with a trailing newline/space is an invalid HTTP
          // header value, and fetch throws a TypeError mislabeled as "Network error".
          'x-goog-api-key': geminiKey.trim(),
        },
        body,
        // A hung connection would otherwise stall enrichment forever with the
        // button stuck on "Enriching…" and zero feedback.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = extractText(await res.json());
        if (text !== null) return { ok: true, text };
        lastError = 'Gemini returned an unexpected response shape';
      } else {
        retryable = res.status === 429 || res.status === 503;
        lastError = `Gemini HTTP ${res.status}`;
        try {
          const errData = (await res.json()) as { error?: { message?: unknown } };
          if (typeof errData.error?.message === 'string') {
            lastError += `: ${errData.error.message.slice(0, 160)}`;
          }
        } catch {
          /* error body wasn't JSON */
        }
      }
    } catch (err) {
      retryable = true; // fetch network failure
      lastError = err instanceof Error ? `Network error: ${err.message}` : 'Network error';
    }
    if (!retryable || attempt >= ENRICH_MAX_RETRIES) return { ok: false, error: lastError };
    await sleep(1000 * 2 ** attempt);
  }
}

// ---------------------------------------------------------------------------
// Pass 1 — summaries + topics (batched)
// ---------------------------------------------------------------------------

interface DocEnrichment {
  summary: string;
  topics: string[];
}

const PASS1_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      docId: { type: 'STRING' },
      summary: { type: 'STRING' },
      topics: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['docId', 'summary', 'topics'],
  },
} as const;

async function enrichBatch(
  batch: DocNode[],
): Promise<{ results: Map<string, DocEnrichment>; error?: string }> {
  const payload = batch.map((n) => ({
    id: n.id,
    title: n.title,
    excerpt: (textStore.get(n.id) ?? n.summary ?? '').slice(0, EXCERPT_CHARS),
  }));
  const prompt = [
    'You are an analyst summarizing internal documentation for a knowledge map.',
    'For EACH document below, return an object with:',
    '- "docId": the id copied exactly as given',
    '- "summary": one crisp sentence (max 25 words) saying what the document covers',
    `- "topics": 3-${TOPICS_PER_DOC} short lowercase topic labels (1-3 words each), specific over generic`,
    '',
    `Documents (JSON): ${JSON.stringify(payload)}`,
  ].join('\n');

  const results = new Map<string, DocEnrichment>();
  const res = await callGemini(prompt, PASS1_SCHEMA);
  if (!res.ok) return { results, error: res.error };
  const parsed = parseModelJson<unknown[]>(res.text);
  if (!Array.isArray(parsed)) {
    return { results, error: 'Gemini response was not a JSON array' };
  }
  const known = new Set(batch.map((n) => n.id));
  for (const item of parsed) {
    const rec = item as { docId?: unknown; summary?: unknown; topics?: unknown };
    if (typeof rec.docId !== 'string' || !known.has(rec.docId)) continue;
    if (typeof rec.summary !== 'string' || rec.summary.trim() === '') continue;
    const topics = Array.isArray(rec.topics)
      ? rec.topics
          .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
          .map((t) => t.trim().toLowerCase())
          .slice(0, TOPICS_PER_DOC)
      : [];
    results.set(rec.docId, { summary: rec.summary.trim(), topics });
  }
  return { results };
}

// ---------------------------------------------------------------------------
// Pass 2 — topic canonicalization (from/to pairs; responseSchema can't do
// dynamic-key maps)
// ---------------------------------------------------------------------------

const PASS2_SCHEMA = {
  type: 'OBJECT',
  properties: {
    canon: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { from: { type: 'STRING' }, to: { type: 'STRING' } },
        required: ['from', 'to'],
      },
    },
  },
  required: ['canon'],
} as const;

async function canonicalizeTopics(topics: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (topics.length < 2) return map;
  const prompt = [
    'These topic labels were extracted from one documentation corpus.',
    'Merge synonyms, spelling variants and abbreviations into a single canonical form',
    '(e.g. "auth", "authentication", "authn" all become "authentication").',
    'Return {"canon": [{"from": existing label, "to": canonical label}, ...]},',
    'listing only labels that should change. Keep canonical forms concise and lowercase.',
    '',
    `Labels (JSON): ${JSON.stringify(topics)}`,
  ].join('\n');
  const res = await callGemini(prompt, PASS2_SCHEMA);
  if (!res.ok) return map; // graceful: keep raw topics
  const parsed = parseModelJson<{ canon?: unknown }>(res.text);
  if (!parsed || !Array.isArray(parsed.canon)) return map;
  for (const pair of parsed.canon) {
    const p = pair as { from?: unknown; to?: unknown };
    if (typeof p.from === 'string' && typeof p.to === 'string' && p.to.trim() !== '') {
      map.set(p.from.trim().toLowerCase(), p.to.trim().toLowerCase());
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Pass 3 — cluster names
// ---------------------------------------------------------------------------

const PASS3_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { cluster: { type: 'NUMBER' }, name: { type: 'STRING' } },
    required: ['cluster', 'name'],
  },
} as const;

async function nameClusters(
  docs: DocNode[],
  topicsOf: Map<string, string[]>,
): Promise<Record<number, string>> {
  const members = new Map<number, DocNode[]>();
  for (const n of docs) {
    if (n.cluster < 0) continue;
    const list = members.get(n.cluster);
    if (list) list.push(n);
    else members.set(n.cluster, [n]);
  }
  if (members.size === 0) return {};

  const clusterInputs = [...members.entries()].map(([cluster, nodes]) => {
    const topicCounts = new Map<string, number>();
    for (const d of nodes) {
      for (const t of topicsOf.get(d.id) ?? d.topics) {
        topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
      }
    }
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
    return {
      cluster,
      titles: nodes.slice(0, CLUSTER_TITLES_CAP).map((d) => d.title),
      topTopics,
    };
  });

  const prompt = [
    'Name each documentation cluster below with a 2-4 word evocative but clear name',
    '(examples: "Deployment & Infra", "Onboarding Guides"). Base each name on the',
    'member titles and top topics. Return an array of {"cluster": number, "name": string}.',
    '',
    `Clusters (JSON): ${JSON.stringify(clusterInputs)}`,
  ].join('\n');

  const res = await callGemini(prompt, PASS3_SCHEMA);
  if (!res.ok) return {}; // graceful: keep existing names
  const parsed = parseModelJson<unknown[]>(res.text);
  if (!Array.isArray(parsed)) return {};
  const names: Record<number, string> = {};
  for (const item of parsed) {
    const rec = item as { cluster?: unknown; name?: unknown };
    const clusterId = typeof rec.cluster === 'number' ? rec.cluster : Number(rec.cluster);
    if (!Number.isFinite(clusterId) || !members.has(clusterId)) continue;
    if (typeof rec.name === 'string' && rec.name.trim() !== '') {
      names[clusterId] = rec.name.trim();
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Per-document AI (side panel): summarize / outline / ask a question.
// Now uses STREAMING for real-time text delivery + plain text output (no JSON
// schema constraint) for lower latency.
// ---------------------------------------------------------------------------

// Document AI is bounded before sending source text to Gemini. The ingest cap
// is intentionally much larger than any model context window.

export type DocAiAction = 'summarize' | 'outline' | 'ask';

/** Why the AI section is locked, or null when it's usable. */
export function docAiBlockedReason(): string | null {
  if (isOffline()) return AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE;
  const { geminiKey, enrichEnabled } = useSettingsStore.getState();
  if (!enrichEnabled) return 'Turn on "Enable enrichment" in Settings';
  if (geminiKey.trim() === '') return 'Add a Gemini API key in Settings';
  return null;
}

/**
 * Stream text from Gemini. Calls `onChunk` with each incremental text piece
 * so the UI can update in real-time. Returns the full accumulated text.
 */
async function streamGemini(
  prompt: string,
  onChunk?: (accumulated: string) => void,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (isOffline()) return { ok: false, error: AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE };
  const { geminiKey } = useSettingsStore.getState();
  const model = resolveGeminiModel('document');
  const url =
    `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  let lastError = 'Unknown Gemini error';
  for (let attempt = 0; ; attempt++) {
    let retryable = false;
    // Inactivity deadline that resets on each received chunk — a fixed
    // wall-clock timeout would abort a long-but-healthy stream (e.g. an
    // "outline covering ALL topics") mid-response and retry from scratch.
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const clearIdle = () => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };
    const armIdle = () => {
      clearIdle();
      idleTimer = setTimeout(
        () => controller.abort(new DOMException('Gemini stream idle timeout', 'TimeoutError')),
        REQUEST_TIMEOUT_MS,
      );
    };
    try {
      armIdle(); // also covers connection latency before the first byte
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey.trim(),
        },
        body: JSON.stringify({
          systemInstruction: geminiSystemInstruction('document'),
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: geminiThinkingConfig('document', model),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        retryable = res.status === 429 || res.status === 503;
        lastError = `Gemini HTTP ${res.status}`;
        try {
          const errData = (await res.json()) as { error?: { message?: unknown } };
          if (typeof errData.error?.message === 'string') {
            lastError += `: ${errData.error.message.slice(0, 160)}`;
          }
        } catch { /* not JSON */ }
        if (!retryable || attempt >= ENRICH_MAX_RETRIES) return { ok: false, error: lastError };
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, error: 'No response body (streaming unavailable)' };

      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle(); // healthy chunk arrived — push the inactivity deadline out
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events: "data: {...}\n\n"
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(jsonStr) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[];
            };
            const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof text === 'string') {
              accumulated += text;
              onChunk?.(accumulated);
            }
          } catch {
            // Malformed chunk — skip
          }
        }
      }

      if (accumulated.trim() === '') {
        return { ok: false, error: 'Gemini returned an empty response' };
      }
      return { ok: true, text: accumulated.trim() };
    } catch (err) {
      retryable = true;
      lastError = err instanceof Error ? `Network error: ${err.message}` : 'Network error';
    } finally {
      clearIdle();
    }
    if (!retryable || attempt >= ENRICH_MAX_RETRIES) return { ok: false, error: lastError };
    await sleep(1000 * 2 ** attempt);
  }
}

export async function askDocAi(
  docId: string,
  title: string,
  action: DocAiAction,
  question?: string,
  onChunk?: (text: string) => void,
): Promise<{ ok: boolean; text: string }> {
  const blocked = docAiBlockedReason();
  if (blocked) return { ok: false, text: blocked };

  const fullText = textStore.get(docId);
  if (!fullText || fullText.trim() === '') {
    return { ok: false, text: 'No readable text is stored for this document.' };
  }

  let task: string;
  switch (action) {
    case 'summarize':
      task =
        'Summarize this document in 4-7 crisp sentences for a busy engineer. ' +
        'Cover its purpose, the key points, and any decisions, numbers or action items. ' +
        'Use plain text only — no markdown formatting.';
      break;
    case 'outline':
      task =
        'Produce a hierarchical outline covering ALL topics in this document, in the ' +
        "document's own order. Format as plain text: one top-level line per major " +
        'section, with nested points indented two spaces and prefixed "- ". Every ' +
        'distinct topic in the document must appear — completeness over brevity. ' +
        'Use plain text only — no markdown formatting.';
      break;
    case 'ask':
      if (!question || question.trim() === '') {
        return { ok: false, text: 'Type a question first.' };
      }
      task =
        'Answer the question below using ONLY this document. If the document does not ' +
        'contain the answer, say so and name what is missing. Be concise and concrete. ' +
        'Use plain text only — no markdown formatting.\n' +
        `Question: ${question.trim()}`;
      break;
  }

  const context = prepareDocumentContext(fullText, action, question);
  const scopeNote = context.truncated
    ? 'Only selected sections of this large document are included below. State that limitation when it affects the answer.'
    : 'The complete document is included below.';
  const prompt = [
    task,
    scopeNote,
    '',
    `Document title: ${title}`,
    'Document text:',
    context.text,
  ].join('\n');

  // Use streaming for real-time delivery
  const res = await streamGemini(prompt, onChunk);
  if (!res.ok) return { ok: false, text: res.error };
  return { ok: true, text: res.text };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

let running = false;

export async function runEnrichment(): Promise<{ ok: boolean; message: string }> {
  if (isOffline()) return { ok: false, message: AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE };
  const { geminiKey, enrichEnabled } = useSettingsStore.getState();
  if (!enrichEnabled) {
    return { ok: false, message: 'Turn on "Enable enrichment" first' };
  }
  if (geminiKey.trim() === '') {
    return { ok: false, message: 'Add a Gemini API key in Settings' };
  }
  const graph = useGraphStore.getState();
  const docs = graph.nodes.filter((n) => n.kind === 'document');
  if (docs.length === 0) {
    return { ok: false, message: 'Nothing to enrich yet — drop some documents first' };
  }
  if (graph.phase !== 'ready') {
    return { ok: false, message: 'Wait for processing to finish before enriching' };
  }
  if (running) {
    return { ok: false, message: 'Enrichment is already running' };
  }

  running = true;
  graph.setPhase('enriching');
  // progress = pass-1 batches + canonicalize + cluster naming
  const batchCount = Math.ceil(docs.length / ENRICH_BATCH_SIZE);
  const totalSteps = batchCount + 2;
  let doneSteps = 0;
  const step = (note: string): void => {
    useGraphStore.getState().setEnrichProgress({ done: doneSteps, total: totalSteps, note });
  };
  try {
    // --- Pass 1: sequential batches (rate-limit friendly); skip failures ---
    const enriched = new Map<string, DocEnrichment>();
    let failedBatches = 0;
    let lastError = '';
    for (let i = 0; i < docs.length; i += ENRICH_BATCH_SIZE) {
      step(`Summarizing docs ${i + 1}–${Math.min(i + ENRICH_BATCH_SIZE, docs.length)} of ${docs.length}`);
      const batch = docs.slice(i, i + ENRICH_BATCH_SIZE);
      const { results, error } = await enrichBatch(batch);
      doneSteps++;
      if (results.size === 0) {
        failedBatches++;
        lastError = error ?? 'batch produced no usable results';
        continue; // graceful: skip this batch, keep going
      }
      for (const [id, e] of results) enriched.set(id, e);
    }
    if (enriched.size === 0) {
      return { ok: false, message: `Enrichment failed: ${lastError || 'no batches succeeded'}` };
    }

    // --- Pass 2: canonicalize topics corpus-wide, apply + dedupe ---
    step('Merging topics…');
    const uniqueTopics = [...new Set([...enriched.values()].flatMap((e) => e.topics))];
    const canon = await canonicalizeTopics(uniqueTopics);
    doneSteps++;
    const finalTopics = new Map<string, string[]>();
    for (const [id, e] of enriched) {
      finalTopics.set(id, [...new Set(e.topics.map((t) => canon.get(t) ?? t))]);
    }

    // Apply summaries + canonical topics to the graph.
    const patches = new Map<string, Partial<DocNode>>();
    for (const [id, e] of enriched) {
      patches.set(id, { summary: e.summary, topics: finalTopics.get(id) ?? e.topics });
    }
    useGraphStore.getState().patchNodes(patches);

    // --- Pass 3: cluster names ---
    step('Naming clusters…');
    const clusterNames = await nameClusters(docs, finalTopics);
    doneSteps++;
    step('Done');
    const namedClusters = Object.keys(clusterNames).length;
    if (namedClusters > 0) {
      const current = useGraphStore.getState().clusterNames;
      useGraphStore.getState().setClusterNames({ ...current, ...clusterNames });
    }

    const topicCount = new Set([...finalTopics.values()].flat()).size;
    let message = `Enriched ${enriched.size} docs, ${topicCount} topics, ${namedClusters} clusters`;
    if (failedBatches > 0) {
      message += ` (${failedBatches} batch${failedBatches === 1 ? '' : 'es'} skipped)`;
    }
    return { ok: true, message };
  } catch (err) {
    return {
      ok: false,
      message: `Enrichment failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    running = false;
    useGraphStore.getState().setEnrichProgress(null);
    // The phase-ready transition also triggers the session auto-save, so
    // fresh summaries/topics/cluster names persist.
    useGraphStore.getState().setPhase('ready');
  }
}
