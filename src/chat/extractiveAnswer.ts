/**
 * Local, no-LLM chat answers: render the best-matching retrieved passages
 * verbatim, grouped by source document, with citations. Used whenever the AI
 * provider is unavailable (airgap build, offline mode, or no key). Pure and
 * synchronous — the retrieval that feeds it (ragChat.retrieveChunks) is what
 * touches embeddings; this only formats.
 */
import { EXTRACT_MAX_PASSAGES, EXTRACT_PASSAGE_CHARS, SOURCE_SNIPPET_CHARS } from '../config';
import type { ChatSource } from '../store/chatStore';

export interface Passage {
  docId: string;
  docTitle: string;
  chunkIndex?: number;
  text: string;
  score: number;
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
  options?: { maxPassages?: number; lead?: 'relevant' | 'corpus' },
): { text: string; sources: ChatSource[] } {
  // Best passage per document, highest score first.
  const bestByDoc = new Map<string, Passage>();
  for (const c of chunks) {
    const cur = bestByDoc.get(c.docId);
    if (!cur || c.score > cur.score) bestByDoc.set(c.docId, c);
  }
  const maxPassages = options?.maxPassages ?? EXTRACT_MAX_PASSAGES;
  const top = [...bestByDoc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPassages);

  if (top.length === 0) {
    return {
      text: "I couldn't find anything relevant to that in your documents.",
      sources: [],
    };
  }

  const q = question.trim();
  const forQuery = q ? ` for "${q}"` : '';
  const lead =
    options?.lead === 'corpus'
      ? `Here ${top.length === 1 ? 'is a passage' : `are ${top.length} passages`} from your documents${forQuery}:`
      : `Here ${top.length === 1 ? 'is the most relevant passage' : `are the ${top.length} most relevant passages`} from your documents${forQuery}:`;
  const blocks = top.map((c) => `**${c.docTitle}**\n\n> ${clip(c.text, EXTRACT_PASSAGE_CHARS).replace(/\n+/g, '\n> ')}`);
  const text = [lead, ...blocks].join('\n\n');

  const sources: ChatSource[] = top.map((c) => ({
    docId: c.docId,
    ...(c.chunkIndex === undefined ? {} : { chunkIndex: c.chunkIndex }),
    snippet: c.text.slice(0, SOURCE_SNIPPET_CHARS).trim(),
    score: c.score,
  }));

  return { text, sources };
}
