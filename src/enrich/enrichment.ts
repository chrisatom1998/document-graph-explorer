/**
 * Optional Layer-3 enrichment via the user's selected AI provider — OpenRouter
 * (cloud, user's API key) or a local Ollama server (spec §5.3).
 *
 * Three sequential passes:
 *   1. Batched summaries + topics per doc (strict JSON, prompt-enforced)
 *   2. Corpus-wide topic canonicalization ("auth"/"authentication"/"AuthN" -> one)
 *   3. Cluster naming ("Deployment & Infra")
 *
 * Every failure path degrades gracefully — the graph is complete without
 * enrichment. runEnrichment never throws and never leaves the phase stuck.
 */

import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';
import { llmComplete, llmStream, type LlmTarget } from '../ai/llmClient';
import {
  ENRICH_BATCH_SIZE,
  ENRICH_CONCURRENCY_CLOUD,
  ENRICH_CONCURRENCY_LOCAL,
} from '../config';
import type { DocNode } from '../model/types';
import { isOffline, OFFLINE_MESSAGE } from '../offline';
import { useGraphStore } from '../store/graphStore';
import { textStore } from '../store/runtimeStores';
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENROUTER_ENRICH_MODEL,
  useSettingsStore,
} from '../store/settingsStore';
import { prepareDocumentContext } from './documentContext';

const EXCERPT_CHARS = 1_200; // Matches the consent disclosure shown before enrichment is enabled.
const CLUSTER_TITLES_CAP = 30;
const TOPICS_PER_DOC = 5;
/** Caps on model-authored per-doc fields (see the parse loop for why). */
const MAX_SUMMARY_CHARS = 1200;
const MAX_TOPIC_CHARS = 48;

/** The provider + model enrichment and doc AI currently target, from Settings. */
export function enrichmentTarget(): LlmTarget {
  const { enrichProvider, openRouterKey, openRouterEnrichModel, ollamaEnrichModel } =
    useSettingsStore.getState();
  return enrichProvider === 'ollama'
    ? { provider: 'ollama', apiKey: '', model: ollamaEnrichModel || DEFAULT_OLLAMA_MODEL }
    : {
        provider: 'openrouter',
        apiKey: openRouterKey,
        model: openRouterEnrichModel || DEFAULT_OPENROUTER_ENRICH_MODEL,
      };
}

/**
 * Run `worker` over every item with at most `limit` in flight, preserving
 * input order in the returned results. Results are collected by index rather
 * than push order so a fast batch finishing ahead of a slow one can't
 * reorder them.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function parseModelJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through — some models wrap JSON in fences despite instructions */
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

// ---------------------------------------------------------------------------
// Pass 1 — summaries + topics (batched)
// ---------------------------------------------------------------------------

interface DocEnrichment {
  summary: string;
  topics: string[];
}

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
    'Respond with ONLY a JSON array of these objects — no prose, no code fences.',
    '',
    `Documents (JSON): ${JSON.stringify(payload)}`,
  ].join('\n');

  const results = new Map<string, DocEnrichment>();
  const res = await llmComplete(enrichmentTarget(), 'enrichment', prompt);
  if (!res.ok) return { results, error: res.error };
  const parsed = parseModelJson<unknown[]>(res.text);
  if (!Array.isArray(parsed)) {
    return { results, error: 'Model response was not a JSON array' };
  }
  const known = new Set(batch.map((n) => n.id));
  for (const item of parsed) {
    const rec = item as { docId?: unknown; summary?: unknown; topics?: unknown };
    if (typeof rec.docId !== 'string' || !known.has(rec.docId)) continue;
    if (typeof rec.summary !== 'string' || rec.summary.trim() === '') continue;
    // Bound what one document's model output can become. Excerpts are
    // untrusted document text, so an injected instruction can steer this
    // response; caps keep the blast radius to this doc's own fields instead
    // of letting an oversized summary or a topic label carrying a paragraph
    // of instructions propagate into pass 2, cluster names, and exports.
    const topics = Array.isArray(rec.topics)
      ? rec.topics
          .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
          .map((t) => t.trim().toLowerCase().slice(0, MAX_TOPIC_CHARS))
          .slice(0, TOPICS_PER_DOC)
      : [];
    results.set(rec.docId, {
      summary: rec.summary.trim().slice(0, MAX_SUMMARY_CHARS),
      topics,
    });
  }
  return { results };
}

// ---------------------------------------------------------------------------
// Pass 2 — topic canonicalization (from/to pairs)
// ---------------------------------------------------------------------------

async function canonicalizeTopics(topics: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (topics.length < 2) return map;
  const prompt = [
    'These topic labels were extracted from one documentation corpus.',
    'Merge synonyms, spelling variants and abbreviations into a single canonical form',
    '(e.g. "auth", "authentication", "authn" all become "authentication").',
    'Respond with ONLY the JSON object {"canon": [{"from": existing label, "to": canonical label}, ...]},',
    'listing only labels that should change. Keep canonical forms concise and lowercase.',
    '',
    `Labels (JSON): ${JSON.stringify(topics)}`,
  ].join('\n');
  const res = await llmComplete(enrichmentTarget(), 'enrichment', prompt);
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
    'member titles and top topics.',
    'Respond with ONLY a JSON array of {"cluster": number, "name": string} — no prose, no code fences.',
    '',
    `Clusters (JSON): ${JSON.stringify(clusterInputs)}`,
  ].join('\n');

  const res = await llmComplete(enrichmentTarget(), 'enrichment', prompt);
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
// Streams plain text for real-time delivery.
// ---------------------------------------------------------------------------

// Document AI is bounded before sending source text to the provider. The
// ingest cap is intentionally much larger than any model context window.

export type DocAiAction = 'summarize' | 'outline' | 'ask';

/** Why the AI section is locked, or null when it's usable. */
export function docAiBlockedReason(): string | null {
  if (isOffline()) return AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE;
  const { enrichEnabled, enrichProvider, openRouterKey } = useSettingsStore.getState();
  if (!enrichEnabled) return 'Turn on "Enable AI enrichment" in Settings';
  if (enrichProvider === 'openrouter' && openRouterKey.trim() === '') {
    return 'Add an OpenRouter API key in Settings';
  }
  return null;
}

export async function askDocAi(
  docId: string,
  title: string,
  action: DocAiAction,
  question?: string,
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
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
  const res = await llmStream(enrichmentTarget(), 'document', prompt, onChunk, signal);
  if (!res.ok) return { ok: false, text: res.error };
  return { ok: true, text: res.text };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

let running = false;

export async function runEnrichment(): Promise<{ ok: boolean; message: string }> {
  if (isOffline()) return { ok: false, message: AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE };
  const { enrichEnabled, enrichProvider, openRouterKey } = useSettingsStore.getState();
  if (!enrichEnabled) {
    return { ok: false, message: 'Turn on "Enable AI enrichment" first' };
  }
  if (enrichProvider === 'openrouter' && openRouterKey.trim() === '') {
    return { ok: false, message: 'Add an OpenRouter API key in Settings' };
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
  const concurrency =
    enrichProvider === 'ollama' ? ENRICH_CONCURRENCY_LOCAL : ENRICH_CONCURRENCY_CLOUD;
  // progress = pass-1 batches + canonicalize + cluster naming
  const batchCount = Math.ceil(docs.length / ENRICH_BATCH_SIZE);
  const totalSteps = batchCount + 2;
  let doneSteps = 0;
  const step = (note: string): void => {
    useGraphStore.getState().setEnrichProgress({ done: doneSteps, total: totalSteps, note });
  };
  try {
    // --- Pass 1: batches run several at a time; failures are skipped ---
    const enriched = new Map<string, DocEnrichment>();
    let failedBatches = 0;
    let lastError = '';
    const batches: DocNode[][] = [];
    for (let i = 0; i < docs.length; i += ENRICH_BATCH_SIZE) {
      batches.push(docs.slice(i, i + ENRICH_BATCH_SIZE));
    }
    let summarized = 0;
    step(`Summarizing 0 of ${docs.length} documents`);
    const batchOutcomes = await mapWithConcurrency(batches, concurrency, async (batch) => {
      const outcome = await enrichBatch(batch);
      // Progress is reported per completed batch, not per started one, so the
      // bar can't run ahead of work that is still in flight.
      doneSteps++;
      summarized += batch.length;
      step(`Summarizing ${summarized} of ${docs.length} documents`);
      return outcome;
    });
    for (const { results, error } of batchOutcomes) {
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
      patches.set(id, { summary: e.summary, topics: finalTopics.get(id) ?? e.topics, topicsSource: 'gemini' });
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
