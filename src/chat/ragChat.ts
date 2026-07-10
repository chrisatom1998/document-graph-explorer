/**
 * RAG (Retrieval-Augmented Generation) chat engine.
 *
 * Flow:
 *   1. User asks a question
 *   2. Embed the query → cosine-search chunk vectors → top-k relevant chunks
 *   3. Build a prompt with the retrieved chunks + recent conversation history
 *   4. Stream the answer back from Gemini token-by-token
 *
 * The knowledge source is `textStore` + `chunkStore` — new files added to the
 * graph are automatically available as context.
 */

import {
  geminiSystemInstruction,
  geminiThinkingConfig,
  resolveGeminiModel,
} from '../ai/geminiModels';
import { EMBED_DIMS, GEMINI_ENDPOINT } from '../config';
import { isOffline } from '../offline';
import { embedQuery } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { chunkStore, docVectorStore, textStore } from '../store/runtimeStores';
import { DEFAULT_OPENROUTER_MODEL, useSettingsStore } from '../store/settingsStore';
import { useChatStore, type ChatMessage, type ChatSource } from '../store/chatStore';
import { formatExtractiveAnswer } from './extractiveAnswer';
import { streamOpenRouterChat } from './openRouterClient';

const RAG_TOP_K = 8; // max chunks to include as context
const RAG_MIN_SCORE = 0.3; // cosine floor for relevance
const RAG_MAX_CHUNKS_PER_DOC = 2; // avoid one long document crowding out the corpus
const CHUNK_CONTEXT_CHARS = 1500; // max chars per chunk in prompt
const REQUEST_TIMEOUT_MS = 120_000; // streaming responses can run long
const MAX_HISTORY_MESSAGES = 8; // prior turns fed back to Gemini for memory
const SOURCE_SNIPPET_CHARS = 200; // citation preview length
const MAX_STREAM_RETRIES = 3; // 429/503 backoff retries before the stream starts

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Cancellation: one in-flight chat request at a time
// ---------------------------------------------------------------------------

let activeAbort: AbortController | null = null;

/** Abort the in-flight chat request, if any. Safe to call when idle. */
export function cancelChat(): void {
  activeAbort?.abort();
}

function isAbortLike(err: unknown): boolean {
  // A user-triggered cancelChat() (AbortError) and the request timeout
  // (TimeoutError) both end the stream gracefully — any partial answer is
  // kept — but the catch block words them differently: the user knows they
  // pressed Stop; a timeout has to say so or it reads like a phantom stop.
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

// ---------------------------------------------------------------------------
// Retrieval: find the most relevant chunks for a query
// ---------------------------------------------------------------------------

interface RetrievedChunk {
  docId: string;
  docTitle: string;
  chunkIndex: number;
  text: string;
  score: number;
}

function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9+#._-]{1,}/g) ?? [])];
}

function lexicalCoverage(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  return terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0) / terms.length;
}

/** Keep the highest-scoring passages without letting a single doc dominate. */
export function diversifyChunks<T extends { docId: string; score: number }>(
  chunks: T[],
  limit: number = RAG_TOP_K,
  perDocument: number = RAG_MAX_CHUNKS_PER_DOC,
): T[] {
  const perDoc = new Map<string, number>();
  const out: T[] = [];
  for (const chunk of [...chunks].sort((a, b) => b.score - a.score)) {
    const count = perDoc.get(chunk.docId) ?? 0;
    if (count >= perDocument) continue;
    out.push(chunk);
    perDoc.set(chunk.docId, count + 1);
    if (out.length >= limit) break;
  }
  return out;
}

/** Return an evidence window around the first matched query term. */
export function keywordEvidence(text: string, terms: string[], maxChars: number): string {
  const lower = text.toLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];
  if (index === undefined) return text.slice(0, maxChars);
  const start = Math.max(0, index - Math.floor(maxChars * 0.3));
  const end = Math.min(text.length, start + maxChars);
  return text.slice(start, end).trim();
}

async function retrieveChunks(query: string): Promise<RetrievedChunk[]> {
  const nodes = useGraphStore.getState().nodes;
  if (nodes.length === 0) return [];

  let qVec: Float32Array;
  try {
    qVec = await embedQuery(query);
  } catch {
    // Embedding unavailable — fall back to keyword matching
    return keywordFallback(query);
  }

  const titleMap = new Map(nodes.map((n) => [n.id, n.title]));
  const hits: RetrievedChunk[] = [];
  const terms = queryTerms(query);

  // Chunk-level retrieval (most precise)
  for (const [docId, chunks] of chunkStore) {
    const vectors = chunks.vectors;
    if (!vectors || vectors.length === 0) continue;
    const dims = chunks.dims > 0 ? chunks.dims : EMBED_DIMS;
    if (qVec.length < dims) continue;

    const nChunks = Math.floor(vectors.length / dims);
    for (let c = 0; c < nChunks; c++) {
      const off = c * dims;
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += vectors[off + d] * qVec[d];
      const text = c < chunks.texts.length ? chunks.texts[c] : '';
      const lexical = lexicalCoverage(text, terms);
      if (dot >= RAG_MIN_SCORE || lexical >= 0.5) {
        hits.push({
          docId,
          docTitle: titleMap.get(docId) ?? docId.slice(0, 8),
          chunkIndex: c,
          text: text.slice(0, CHUNK_CONTEXT_CHARS),
          // Dense retrieval captures paraphrase; a small exact-term boost
          // protects acronyms, ticket IDs, and product names.
          score: dot + lexical * 0.12,
        });
      }
    }
  }

  // Doc-level fallback for imported graphs without chunk vectors
  for (const [docId, vec] of docVectorStore) {
    if (chunkStore.get(docId)?.vectors) continue; // already covered
    if (vec.length !== qVec.length) continue;
    let dot = 0;
    for (let d = 0; d < vec.length; d++) dot += vec[d] * qVec[d];
    if (dot >= RAG_MIN_SCORE) {
      const text = (textStore.get(docId) ?? '').slice(0, CHUNK_CONTEXT_CHARS * 2);
      hits.push({
        docId,
        docTitle: titleMap.get(docId) ?? docId.slice(0, 8),
        chunkIndex: 0,
        text,
        score: dot,
      });
    }
  }

  return diversifyChunks(hits);
}

/** Simple keyword fallback when embeddings aren't available. */
function keywordFallback(query: string): RetrievedChunk[] {
  const nodes = useGraphStore.getState().nodes;
  const qLower = query.toLowerCase();
  const qTokens = queryTerms(qLower).filter((t) => t.length > 2);
  const hits: RetrievedChunk[] = [];

  for (const n of nodes) {
    if (n.kind !== 'document') continue;
    const text = textStore.get(n.id) ?? '';
    const textLower = text.toLowerCase();
    const titleMatch = n.title.toLowerCase().includes(qLower);
    const tokenHits = qTokens.filter((t) => textLower.includes(t)).length;

    if (titleMatch || tokenHits >= Math.max(1, qTokens.length * 0.4)) {
      hits.push({
        docId: n.id,
        docTitle: n.title,
        chunkIndex: 0,
        text: keywordEvidence(text, qTokens, CHUNK_CONTEXT_CHARS * 2),
        score: titleMatch ? 1.0 : tokenHits / qTokens.length,
      });
    }
  }

  return diversifyChunks(hits);
}

/** Per unique doc, keep the single best-scoring chunk as its citation. */
function bestChunkSources(chunks: RetrievedChunk[]): ChatSource[] {
  const bestByDoc = new Map<string, RetrievedChunk>();
  for (const c of chunks) {
    const cur = bestByDoc.get(c.docId);
    if (!cur || c.score > cur.score) bestByDoc.set(c.docId, c);
  }
  return [...bestByDoc.values()]
    .sort((a, b) => b.score - a.score)
    .map((c) => ({
      docId: c.docId,
      chunkIndex: c.chunkIndex,
      snippet: c.text.slice(0, SOURCE_SNIPPET_CHARS).trim(),
      score: c.score,
    }));
}

// ---------------------------------------------------------------------------
// Generation: send context + question + history to Gemini, streaming back
// ---------------------------------------------------------------------------

interface GeminiTurn {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const contextParts = chunks.map(
    (c, i) => `[Source ${i + 1}: "${c.docTitle}", passage ${c.chunkIndex + 1}]\n${c.text}`,
  );

  return [
    'You are a knowledgeable assistant answering questions about the user\'s document collection.',
    'Use ONLY the context provided below. If the context does not contain the answer, say so clearly.',
    'Every factual claim must be supported by a source below. Cite supporting claims inline as [Source N].',
    'Do not cite a source that does not support the claim, and do not invent facts, source names, or citation numbers.',
    'Be concise and specific. When the evidence is incomplete or conflicting, state that limitation.',
    'Format your response in Markdown.',
    '',
    '--- CONTEXT ---',
    contextParts.join('\n\n'),
    '--- END CONTEXT ---',
    '',
    `User question: ${question}`,
  ].join('\n');
}

/**
 * Turns prior user/assistant messages into Gemini `contents` turns for
 * multi-turn memory. `messages` must be the history captured BEFORE the
 * current question (and its assistant placeholder) were added, so both are
 * naturally excluded. System messages are dropped (they're app notices, not
 * conversation), and failed assistant turns are dropped too — no reason to
 * teach the model its own errors.
 */
export function buildHistoryTurns(messages: ChatMessage[]): GeminiTurn[] {
  const usable = messages.filter((m) => {
    if (m.role === 'system') return false;
    if (m.role === 'assistant' && (m.isError || m.text.startsWith('Error:'))) return false;
    return true;
  });
  const turns: GeminiTurn[] = usable.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.text }],
  }));

  // Gemini rejects multiturn contents that don't strictly alternate starting
  // with 'user'. The filtering above (dropped error/system replies) and the
  // slice window can both break that shape — one errored turn would 400 every
  // later question. Normalize: no leading model turn, merge consecutive
  // same-role turns, and end on a model turn (the caller appends the current
  // user question next).
  while (turns.length > 0 && turns[0].role === 'model') turns.shift();
  const merged: GeminiTurn[] = [];
  for (const turn of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts = [{ text: `${prev.parts[0].text}\n\n${turn.parts[0].text}` }];
    } else {
      merged.push(turn);
    }
  }
  while (merged.length > 0 && merged[merged.length - 1].role === 'user') merged.pop();
  return merged;
}

/** Send a chat message and get an AI response. */
export async function sendChatMessage(question: string): Promise<void> {
  const q = question.trim();
  if (!q) return;

  const { chatProvider, geminiKey, openRouterKey, openRouterModel } = useSettingsStore.getState();
  const chat = useChatStore.getState();

  // Snapshot the conversation BEFORE this turn, for multi-turn memory. This
  // naturally excludes the user message and assistant placeholder added below.
  const priorMessages = chat.messages;

  // Add user message
  chat.addMessage({ role: 'user', text: q });

  // When Gemini isn't available (airgap build, enrichment off, or no key), answer
  // locally by extracting the best-matching passages — no network, no refusal.
  const selectedKey = chatProvider === 'openrouter' ? openRouterKey : geminiKey;
  const useLocal = isOffline() || chatProvider === 'local' || selectedKey.trim() === '';

  const docCount = useGraphStore.getState().nodes.filter((n) => n.kind === 'document').length;
  if (docCount === 0) {
    chat.addMessage({
      role: 'system',
      text: 'No documents loaded yet. Drop some files onto the graph first.',
    });
    return;
  }

  // Add placeholder assistant message
  chat.setIsStreaming(true);
  const assistantId = chat.addMessage({ role: 'assistant', text: 'Searching documents…' });

  const controller = new AbortController();
  activeAbort = controller;
  let accumulated = '';
  let sources: ChatSource[] | undefined;
  // Manual timeout instead of AbortSignal.any([controller, AbortSignal.timeout]):
  // same behavior, works on browsers that predate .any(), and the reason lets
  // the catch block tell a timeout apart from a user-pressed Stop.
  const timeoutTimer = setTimeout(
    () => controller.abort(new DOMException('AI request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );

  try {
    // Retrieve relevant chunks
    const chunks = await retrieveChunks(q);

    if (useLocal) {
      const { text, sources: localSources } = formatExtractiveAnswer(q, chunks);
      useChatStore.getState().updateMessage(assistantId, {
        text,
        ...(localSources.length ? { sources: localSources } : {}),
      });
      return;
    }

    if (chunks.length === 0) {
      useChatStore.getState().updateMessage(assistantId, {
        text: 'I couldn\'t find any relevant content in your documents for this question. Try rephrasing or make sure the relevant files have been uploaded.',
      });
      return;
    }

    // Update status
    useChatStore.getState().updateMessage(assistantId, {
      text: `Found ${chunks.length} relevant passage${chunks.length > 1 ? 's' : ''}. Generating answer…`,
    });

    sources = bestChunkSources(chunks);

    // Build prompt + multi-turn history and stream from Gemini.
    const prompt = buildPrompt(q, chunks);
    if (chatProvider === 'openrouter') {
      const answer = await streamOpenRouterChat({
        apiKey: openRouterKey,
        model: openRouterModel || DEFAULT_OPENROUTER_MODEL,
        prompt,
        history: priorMessages,
        signal: controller.signal,
        onText: (text) => {
          accumulated = text;
          useChatStore.getState().updateMessage(assistantId, { text });
        },
        onRetry: (status) => {
          useChatStore.getState().updateMessage(assistantId, {
            text: `OpenRouter is busy (${status}) - retrying...`,
          });
        },
      });
      accumulated = answer;
      useChatStore.getState().updateMessage(assistantId, { text: answer, sources });
      return;
    }
    const model = resolveGeminiModel('chat');
    const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const contents: GeminiTurn[] = [
      ...buildHistoryTurns(priorMessages),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    // Transient failures (429 rate limit / 503 overload) retry with backoff
    // BEFORE the stream starts. A stream that dies mid-body is never retried:
    // re-running it would duplicate text the user has already seen. An abort
    // during the backoff sleep surfaces on the next fetch as an AbortError.
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Key travels as a header, not a query param: URLs leak into
          // proxy/server logs and browser history; headers don't.
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          systemInstruction: geminiSystemInstruction('chat'),
          contents,
          generationConfig: geminiThinkingConfig('chat', model),
        }),
        signal: controller.signal,
      });
      if (res.ok) break;

      const retryable = res.status === 429 || res.status === 503;
      let errMsg = `Gemini HTTP ${res.status}`;
      try {
        const errData = (await res.json()) as { error?: { message?: unknown } };
        if (typeof errData.error?.message === 'string') {
          errMsg += `: ${errData.error.message.slice(0, 200)}`;
        }
      } catch { /* ignore */ }
      if (!retryable || attempt >= MAX_STREAM_RETRIES) {
        useChatStore.getState().updateMessage(assistantId, { text: `Error: ${errMsg}` });
        return;
      }
      useChatStore.getState().updateMessage(assistantId, {
        text: `Gemini is busy (${res.status}) — retrying…`,
      });
      await sleep(1000 * 2 ** attempt);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      useChatStore.getState().updateMessage(assistantId, {
        text: 'Gemini\'s streaming response had no body. Please try again.',
      });
      return;
    }

    // Parse the `data: {...}` SSE lines streamGenerateContent emits. Chunks
    // from reader.read() can split in the middle of a line, so we buffer
    // whatever's left after the last newline and prepend it to the next read.
    // A stream can also carry an error object or a blocked candidate after
    // the 200 header — capture those so an empty answer names its cause.
    // (object properties, not lets: closure writes don't fight TS narrowing)
    const streamMeta = { error: null as string | null, blockReason: null as string | null };
    const decoder = new TextDecoder();
    let buffer = '';
    const consumeLine = (rawLine: string): void => {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) return; // blank lines / "event:" framing
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let evt: {
        candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: unknown }[];
        promptFeedback?: { blockReason?: unknown };
        error?: { message?: unknown };
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        return; // partial/keepalive line — ignore
      }
      if (typeof evt.error?.message === 'string') streamMeta.error = evt.error.message;
      if (typeof evt.promptFeedback?.blockReason === 'string') {
        streamMeta.blockReason = evt.promptFeedback.blockReason;
      }
      const candidate = evt.candidates?.[0];
      const finish = candidate?.finishReason;
      if (typeof finish === 'string' && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
        streamMeta.blockReason = finish; // SAFETY / RECITATION / OTHER
      }
      for (const part of candidate?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text) accumulated += part.text;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      const before = accumulated;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
      }
      if (done) {
        buffer += decoder.decode(); // flush any trailing partial byte sequence
        if (buffer) consumeLine(buffer);
      }
      // One store write per network chunk, not per SSE line — every write
      // clones the message list and re-renders the whole transcript.
      if (accumulated !== before) {
        useChatStore.getState().updateMessage(assistantId, { text: accumulated });
      }
      if (done) break;
    }

    if (accumulated.trim() === '') {
      useChatStore.getState().updateMessage(assistantId, {
        text: streamMeta.error
          ? `Error: Gemini stream failed: ${streamMeta.error.slice(0, 200)}`
          : streamMeta.blockReason
            ? `Error: Gemini blocked the response (${streamMeta.blockReason}).`
            : 'Gemini returned an empty response. Please try again.',
      });
    } else {
      useChatStore.getState().updateMessage(assistantId, { text: accumulated.trim(), sources });
    }
  } catch (err) {
    if (isAbortLike(err)) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      const trimmed = accumulated.trim();
      useChatStore.getState().updateMessage(assistantId, {
        text: trimmed
          ? `${trimmed}\n\n${timedOut ? '_⏱ timed out — partial answer_' : '_⏹ stopped_'}`
          : timedOut
            ? `Error: The selected AI provider didn't respond within ${REQUEST_TIMEOUT_MS / 1000}s. Check your network or try again.`
            : 'Stopped.',
        ...(sources ? { sources } : {}),
      });
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      useChatStore.getState().updateMessage(assistantId, { text: `Error: ${errMsg}` });
    }
  } finally {
    clearTimeout(timeoutTimer);
    useChatStore.getState().setIsStreaming(false);
    activeAbort = null;
  }
}
