/**
 * Local, no-LLM chat answers: render the best-matching retrieved passages
 * verbatim, grouped by source document, with citations. Used whenever Gemini
 * is unavailable (airgap build, or enrichment off / no key). Pure and
 * synchronous — the retrieval that feeds it (ragChat.retrieveChunks) is what
 * touches embeddings; this only formats.
 */
import { EXTRACT_MAX_PASSAGES, EXTRACT_PASSAGE_CHARS, SOURCE_SNIPPET_CHARS } from '../config';
import type { ChatSource } from '../store/chatStore';

export interface Passage {
  docId: string;
  docTitle: string;
  text: string;
  score: number;
}

/**
 * Keep only the best-scoring item per `docId`, sorted by score descending.
 * Shared between this module and ragChat.ts (both dedupe retrieved chunks
 * down to "the one best passage per source document" before citing them).
 */
export function bestPerDocument<T extends { docId: string; score: number }>(
  items: readonly T[],
): T[] {
  const bestByDoc = new Map<string, T>();
  for (const item of items) {
    const cur = bestByDoc.get(item.docId);
    if (!cur || item.score > cur.score) bestByDoc.set(item.docId, item);
  }
  return [...bestByDoc.values()].sort((a, b) => b.score - a.score);
}

/** A passage's citation chip: doc id + a truncated preview + its score. */
export function toSnippetSource(c: { docId: string; text: string; score: number }): ChatSource {
  return { docId: c.docId, snippet: c.text.slice(0, SOURCE_SNIPPET_CHARS).trim(), score: c.score };
}

/** Truncate on a word boundary near `max`, appending an ellipsis when cut. */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function formatExtractiveAnswer(
  question: string,
  chunks: readonly Passage[],
): { text: string; sources: ChatSource[] } {
  const top = bestPerDocument(chunks).slice(0, EXTRACT_MAX_PASSAGES);

  if (top.length === 0) {
    return {
      text: "I couldn't find anything relevant to that in your documents.",
      sources: [],
    };
  }

  const q = question.trim();
  const lead = `Here ${top.length === 1 ? 'is the most relevant passage' : `are the ${top.length} most relevant passages`} from your documents${q ? ` for "${q}"` : ''}:`;
  const blocks = top.map((c) => `**${c.docTitle}**\n\n> ${clip(c.text, EXTRACT_PASSAGE_CHARS).replace(/\n+/g, '\n> ')}`);
  const text = [lead, ...blocks].join('\n\n');

  const sources: ChatSource[] = top.map(toSnippetSource);

  return { text, sources };
}
