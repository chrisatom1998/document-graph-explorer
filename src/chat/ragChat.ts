/**
 * RAG (Retrieval-Augmented Generation) chat engine.
 *
 * Flow:
 *   1. User asks a question
 *   2. Embed the query → cosine-search chunk vectors → top-k relevant chunks
 *   3. Build a prompt with the retrieved chunks as context
 *   4. Send to Gemini → stream back the answer
 *
 * The knowledge source is `textStore` + `chunkStore` — new files added to the
 * graph are automatically available as context.
 */

import { EMBED_DIMS, GEMINI_ENDPOINT, GEMINI_MODEL } from '../config';
import { embedQuery } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { chunkStore, docVectorStore, textStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { useChatStore } from '../store/chatStore';

const RAG_TOP_K = 8; // max chunks to include as context
const RAG_MIN_SCORE = 0.3; // cosine floor for relevance
const CHUNK_CONTEXT_CHARS = 1500; // max chars per chunk in prompt
const REQUEST_TIMEOUT_MS = 60_000;

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
      if (dot >= RAG_MIN_SCORE) {
        const text = c < chunks.texts.length ? chunks.texts[c] : '';
        hits.push({
          docId,
          docTitle: titleMap.get(docId) ?? docId.slice(0, 8),
          chunkIndex: c,
          text: text.slice(0, CHUNK_CONTEXT_CHARS),
          score: dot,
        });
      }
    }
  }

  // Doc-level fallback for imported graphs without chunk vectors
  for (const [docId, vec] of docVectorStore) {
    if (chunkStore.has(docId)) continue; // already covered
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

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, RAG_TOP_K);
}

/** Simple keyword fallback when embeddings aren't available. */
function keywordFallback(query: string): RetrievedChunk[] {
  const nodes = useGraphStore.getState().nodes;
  const qLower = query.toLowerCase();
  const qTokens = qLower.split(/\s+/).filter((t) => t.length > 2);
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
        text: text.slice(0, CHUNK_CONTEXT_CHARS * 2),
        score: titleMatch ? 1.0 : tokenHits / qTokens.length,
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, RAG_TOP_K);
}

// ---------------------------------------------------------------------------
// Generation: send context + question to Gemini
// ---------------------------------------------------------------------------

function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const contextParts = chunks.map(
    (c, i) => `[Source ${i + 1}: "${c.docTitle}"]\n${c.text}`,
  );

  return [
    'You are a knowledgeable assistant answering questions about the user\'s document collection.',
    'Use ONLY the context provided below. If the context does not contain the answer, say so clearly.',
    'Be concise, specific, and cite which source document(s) your answer comes from.',
    'Format your response in plain text with line breaks for readability.',
    '',
    '--- CONTEXT ---',
    contextParts.join('\n\n'),
    '--- END CONTEXT ---',
    '',
    `User question: ${question}`,
  ].join('\n');
}

/** Send a chat message and get an AI response. */
export async function sendChatMessage(question: string): Promise<void> {
  const q = question.trim();
  if (!q) return;

  const { geminiKey, geminiModel, enrichEnabled } = useSettingsStore.getState();
  const chat = useChatStore.getState();

  // Add user message
  chat.addMessage({ role: 'user', text: q });

  // Validate API availability
  if (!enrichEnabled || geminiKey.trim() === '') {
    chat.addMessage({
      role: 'system',
      text: !enrichEnabled
        ? 'Turn on "Enable enrichment" in Settings to use the chat feature.'
        : 'Add a Gemini API key in Settings to use the chat feature.',
    });
    return;
  }

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

  try {
    // Retrieve relevant chunks
    const chunks = await retrieveChunks(q);

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

    // Build prompt and call Gemini
    const prompt = buildPrompt(q, chunks);
    const model = geminiModel.trim() || GEMINI_MODEL;
    const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { answer: { type: 'STRING' } },
            required: ['answer'],
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      let errMsg = `Gemini HTTP ${res.status}`;
      try {
        const errData = (await res.json()) as { error?: { message?: unknown } };
        if (typeof errData.error?.message === 'string') {
          errMsg += `: ${errData.error.message.slice(0, 200)}`;
        }
      } catch { /* ignore */ }
      useChatStore.getState().updateMessage(assistantId, { text: `Error: ${errMsg}` });
      return;
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    };
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof rawText !== 'string') {
      useChatStore.getState().updateMessage(assistantId, {
        text: 'Received an unexpected response from Gemini. Please try again.',
      });
      return;
    }

    // Parse the JSON response
    let answer: string;
    try {
      const parsed = JSON.parse(rawText) as { answer?: string };
      answer = parsed.answer ?? rawText;
    } catch {
      // If JSON parsing fails, try stripping markdown fences
      const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        const parsed = JSON.parse(stripped) as { answer?: string };
        answer = parsed.answer ?? rawText;
      } catch {
        answer = rawText; // Use raw text as fallback
      }
    }

    // Deduplicate source doc IDs
    const sourceIds = [...new Set(chunks.map((c) => c.docId))];

    useChatStore.getState().updateMessage(assistantId, {
      text: answer.trim(),
      sources: sourceIds,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    useChatStore.getState().updateMessage(assistantId, {
      text: `Error: ${errMsg}`,
    });
  } finally {
    useChatStore.getState().setIsStreaming(false);
  }
}
