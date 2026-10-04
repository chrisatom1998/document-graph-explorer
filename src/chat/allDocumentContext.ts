/**
 * Build one evidence block per loaded document for all-documents chat.
 * Query-ranked passages win; documents that did not retrieve still appear
 * via chunk text, stored body, or the ingest summary.
 */
import {
  RAG_ALL_DOCS_MAX_CHARS,
  RAG_ALL_DOCS_MIN_CHARS_PER_DOC,
  charsPerDocumentForBudget,
} from './chatContextBudget';
import { CHUNK_CONTEXT_CHARS } from './ragChatConstants';
import type { DocNode } from '../model/types';
import type { ChunkData } from '../store/runtimeStores';

export interface CorpusChunk {
  docId: string;
  docTitle: string;
  chunkIndex?: number;
  text: string;
  score: number;
}

export interface AssembleAllDocumentsResult {
  chunks: CorpusChunk[];
  included: number;
  total: number;
  truncated: boolean;
  charsPerDocument: number;
}

function clipText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function fallbackDocumentEvidence(
  node: DocNode,
  texts: ReadonlyMap<string, string>,
  chunks: ReadonlyMap<string, ChunkData>,
): { text: string; chunkIndex?: number } {
  const data = chunks.get(node.id);
  if (data?.texts?.[0]) return { text: data.texts[0], chunkIndex: 0 };
  const full = texts.get(node.id)?.trim();
  if (full) return { text: full };
  if (node.summary?.trim()) return { text: node.summary };
  const meta = [
    node.topics.length > 0 ? `Topics: ${node.topics.join(', ')}` : '',
    node.entities.length > 0 ? `Entities: ${node.entities.join(', ')}` : '',
    node.keywords.length > 0 ? `Keywords: ${node.keywords.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return { text: meta || node.title };
}

export function assembleAllDocumentChunks(
  retrieved: readonly CorpusChunk[],
  documents: readonly DocNode[],
  texts: ReadonlyMap<string, string>,
  chunks: ReadonlyMap<string, ChunkData>,
  maxTotalChars: number = RAG_ALL_DOCS_MAX_CHARS,
  maxCharsPerDoc: number = CHUNK_CONTEXT_CHARS,
  minCharsPerDoc: number = RAG_ALL_DOCS_MIN_CHARS_PER_DOC,
): AssembleAllDocumentsResult {
  const docs = documents.filter((node) => node.kind === 'document');
  const best = new Map<string, CorpusChunk>();
  for (const hit of retrieved) {
    if (!hit.text.trim()) continue;
    const cur = best.get(hit.docId);
    if (!cur || hit.score > cur.score) best.set(hit.docId, hit);
  }

  const assembled: CorpusChunk[] = docs
    .map((node) => {
      const hit = best.get(node.id);
      if (hit?.text.trim()) return { ...hit };
      const fallback = fallbackDocumentEvidence(node, texts, chunks);
      return {
        docId: node.id,
        docTitle: node.title,
        ...(fallback.chunkIndex === undefined ? {} : { chunkIndex: fallback.chunkIndex }),
        text: fallback.text,
        score: 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));

  return fitChunksToBudget(assembled, maxTotalChars, maxCharsPerDoc, minCharsPerDoc);
}

export function fitChunksToBudget(
  items: CorpusChunk[],
  maxTotalChars: number,
  maxCharsPerDoc: number,
  minCharsPerDoc: number,
): AssembleAllDocumentsResult {
  const total = items.length;
  if (total === 0) {
    return { chunks: [], included: 0, total: 0, truncated: false, charsPerDocument: maxCharsPerDoc };
  }

  const charsPerDocument = charsPerDocumentForBudget(
    total,
    maxTotalChars,
    maxCharsPerDoc,
    minCharsPerDoc,
  );
  const maxDocs = Math.max(1, Math.floor(maxTotalChars / charsPerDocument));
  const kept = items.slice(0, Math.min(total, maxDocs));
  return {
    chunks: kept.map((chunk) => ({ ...chunk, text: clipText(chunk.text, charsPerDocument) })),
    included: kept.length,
    total,
    truncated: kept.length < total,
    charsPerDocument,
  };
}
