/**
 * Model choices for the Settings pickers.
 *
 * OpenRouter lists 350+ models, most of them a bad fit here: enrichment runs
 * dozens of sequential batch requests over a whole corpus, so a large
 * reasoning model turns a two-minute job into an hour. Rather than offer the
 * raw catalog and let users pick something that will crawl, we ship a curated
 * shortlist of fast, cheap, large-context models that all follow
 * "return only JSON" reliably, and validate it against the live catalog so a
 * retired model never appears.
 *
 * Ollama models come from the user's own server — whatever they have pulled.
 */

import { type LlmProvider } from './llmClient';

export const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
export const OLLAMA_MODELS_ENDPOINT = 'http://127.0.0.1:11434/v1/models';

const FETCH_TIMEOUT_MS = 10_000;

export interface RecommendedModel {
  id: string;
  label: string;
  /** Shown next to the label — why you'd pick this one. */
  note: string;
}

/**
 * Ordered best-first for corpus enrichment and per-document AI. Every entry
 * is a "fast tier" model (flash / lite / mini / haiku class) with at least a
 * 200k context window, so the same choice also serves per-document AI, which
 * can send up to ~60k tokens of a single document.
 */
export const RECOMMENDED_ENRICH_MODELS: RecommendedModel[] = [
  {
    id: 'google/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    note: 'Fastest · 1M context · built for high-volume extraction',
  },
  {
    id: 'google/gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    note: 'Latest Flash · 1M context · cheap enough for corpus runs',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    note: 'Best instruction-following at speed · 200k context',
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 mini',
    note: 'Fast and inexpensive · 400k context',
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    note: 'Newer Flash Lite · 1M context',
  },
  {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    label: 'Mistral Small 3.2',
    note: 'Open weights · very cheap · 256k context',
  },
  {
    id: 'qwen/qwen3.7-flash',
    label: 'Qwen3.7 Flash',
    note: 'Lowest cost · 1M context',
  },
  {
    id: 'z-ai/glm-4.7-flash',
    label: 'GLM 4.7 Flash',
    note: 'Very cheap · 200k context',
  },
];

/**
 * Ordered best-first for document chat. Chat is one request per question, not
 * one per 15 documents, so quality is affordable here in a way it is not for
 * enrichment — this list leads with flagship models and keeps the fast tier
 * as the cheap option rather than the default.
 */
export const RECOMMENDED_CHAT_MODELS: RecommendedModel[] = [
  {
    id: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5',
    note: 'Best overall for grounded answers · 1M context',
  },
  {
    id: 'openai/gpt-5.4',
    label: 'GPT-5.4',
    note: 'Strong reasoning · 1M context',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    note: 'Strong reasoning · 1M context',
  },
  {
    id: 'google/gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    note: 'Latest Flash · 1M context',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    note: 'Fast and inexpensive · 200k context',
  },
  {
    id: 'google/gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    note: 'Fast · 1M context',
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 mini',
    note: 'Fast and inexpensive · 400k context',
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    note: 'Fastest · lowest cost · 1M context',
  },
];

/** Local models small enough to keep enrichment moving on typical hardware. */
export const SUGGESTED_OLLAMA_MODELS = ['llama3.2', 'qwen2.5:7b', 'mistral', 'phi4'];

export type ModelCatalog =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

export function parseModelList(data: unknown): string[] {
  const d = data as { data?: { id?: unknown }[] } | null;
  if (!Array.isArray(d?.data)) return [];
  return d.data
    .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
    .filter((id) => id !== '')
    .sort((a, b) => a.localeCompare(b));
}

/** Chat and enrichment have different speed/quality tradeoffs — see each list. */
export type ModelPurpose = 'chat' | 'enrichment';

export function recommendedModels(purpose: ModelPurpose): RecommendedModel[] {
  return purpose === 'chat' ? RECOMMENDED_CHAT_MODELS : RECOMMENDED_ENRICH_MODELS;
}

/**
 * The options an OpenRouter picker should show: the curated shortlist for
 * this purpose, narrowed to what the live catalog actually serves (when we
 * could read it), plus `current` when it isn't one of them — a model saved
 * before this list existed must stay selectable rather than silently
 * switching itself.
 */
export function openRouterModelOptions(
  purpose: ModelPurpose,
  available: string[] | null,
  current: string,
): ModelOption[] {
  const servesModel = (id: string) => available === null || available.includes(id);
  const options: ModelOption[] = recommendedModels(purpose)
    .filter((m) => servesModel(m.id))
    .map((m) => ({ id: m.id, label: m.label, note: m.note }));

  if (current.trim() !== '' && !options.some((o) => o.id === current)) {
    options.push({ id: current, label: current, note: 'your saved model' });
  }
  return options;
}

export async function fetchModelCatalog(
  provider: LlmProvider,
  apiKey: string,
): Promise<ModelCatalog> {
  const url = provider === 'ollama' ? OLLAMA_MODELS_ENDPOINT : OPENROUTER_MODELS_ENDPOINT;
  const headers: Record<string, string> = {};
  // OpenRouter's catalog is public, but sending the key surfaces an invalid
  // key as a clear 401 here instead of at first enrichment/chat use.
  if (provider === 'openrouter' && apiKey.trim() !== '') {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const models = parseModelList(await res.json());
    if (models.length === 0) {
      return {
        ok: false,
        error: provider === 'ollama' ? 'No models installed (ollama pull <model>)' : 'No models listed',
      };
    }
    return { ok: true, models };
  } catch {
    return {
      ok: false,
      error:
        provider === 'ollama'
          ? 'Could not reach Ollama at 127.0.0.1:11434 (ollama serve)'
          : 'Could not load the OpenRouter model list',
    };
  }
}
