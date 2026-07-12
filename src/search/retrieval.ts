import { EMBED_DIMS } from '../config';
import type { DocNode } from '../model/types';
import { embedQuery as defaultEmbedQuery } from '../pipeline/coordinator';
import {
  chunkStore as defaultChunkStore,
  docVectorStore as defaultDocVectorStore,
  textStore as defaultTextStore,
  type ChunkData,
} from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { diversifyRanked, reciprocalRankFusion } from './hybridRank';

export type RetrievalMatchKind = 'title' | 'keyword' | 'semantic' | 'hybrid';

export interface RetrievalHit {
  docId: string;
  docTitle: string;
  passageIndex: number;
  text: string;
  semanticScore?: number;
  lexicalScore?: number;
  semanticRank?: number;
  lexicalRank?: number;
  fusedScore: number;
  matchKind: RetrievalMatchKind;
}

export interface RetrievalOptions {
  limit?: number;
  perDocument?: number;
  timeoutMs?: number;
  minSemanticScore?: number;
  maxPassageChars?: number;
}

export interface RetrievalDependencies {
  nodes: DocNode[];
  chunks: ReadonlyMap<string, ChunkData>;
  docVectors: ReadonlyMap<string, Float32Array>;
  texts: ReadonlyMap<string, string>;
  embedQuery: (query: string) => Promise<Float32Array>;
}

interface Candidate {
  id: string;
  docId: string;
  docTitle: string;
  passageIndex: number;
  text: string;
  groupId: string;
  titleMatch: boolean;
  semanticScore?: number;
  lexicalScore?: number;
  semanticRank?: number;
  lexicalRank?: number;
}

const DEFAULT_LIMIT = 12;
const DEFAULT_PER_DOCUMENT = 1;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_SEMANTIC_SCORE = 0.3;
const DEFAULT_MAX_PASSAGE_CHARS = 3_000;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'did', 'do', 'does', 'for',
  'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why',
  'with', 'your',
]);

export function retrievalTerms(value: string): string[] {
  return [...new Set(
    (value.toLowerCase().match(/[a-z0-9][a-z0-9+#._-]*/g) ?? [])
      .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
  )];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function lexicalRelevance(
  query: string,
  text: string,
  title: string = '',
): { score: number; titleMatch: boolean } {
  const terms = retrievalTerms(query);
  if (terms.length === 0) return { score: 0, titleMatch: false };

  const queryText = normalized(query);
  const body = normalized(text);
  const normalizedTitle = normalized(title);
  const titleMatch = normalizedTitle.length > 0 && normalizedTitle.includes(queryText);
  const bodyHits = terms.filter((term) => body.includes(term)).length;
  const titleHits = terms.filter((term) => normalizedTitle.includes(term)).length;
  const coverage = bodyHits / terms.length;
  const titleCoverage = titleHits / terms.length;
  const exactPhrase = queryText.length > 2 && body.includes(queryText);

  // Require meaningful coverage for multi-term questions. This prevents one
  // generic word from turning an unrelated passage into a no-answer false hit.
  if (!titleMatch && !exactPhrase && coverage < (terms.length === 1 ? 1 : 0.4)) {
    return { score: 0, titleMatch: false };
  }

  return {
    score: coverage + titleCoverage * 0.35 + (exactPhrase ? 0.2 : 0) + (titleMatch ? 0.35 : 0),
    titleMatch,
  };
}

function dotProduct(a: Float32Array, b: Float32Array, offset = 0, dims = b.length): number {
  let dot = 0;
  for (let i = 0; i < dims; i++) dot += a[offset + i] * b[i];
  return dot;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`query embedding timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function candidateId(docId: string, passageIndex: number): string {
  return `${docId}\u0000${passageIndex}`;
}

function upsertCandidate(
  candidates: Map<string, Candidate>,
  input: Omit<Candidate, 'id' | 'groupId' | 'titleMatch'> & { titleMatch?: boolean },
): Candidate {
  const id = candidateId(input.docId, input.passageIndex);
  const existing = candidates.get(id);
  if (existing) {
    if (input.semanticScore !== undefined) existing.semanticScore = input.semanticScore;
    if (input.lexicalScore !== undefined) existing.lexicalScore = input.lexicalScore;
    existing.titleMatch ||= input.titleMatch ?? false;
    if (!existing.text && input.text) existing.text = input.text;
    return existing;
  }
  const created: Candidate = {
    ...input,
    id,
    groupId: input.docId,
    titleMatch: input.titleMatch ?? false,
  };
  candidates.set(id, created);
  return created;
}

function passagesForDocument(
  docId: string,
  chunks: ReadonlyMap<string, ChunkData>,
  texts: ReadonlyMap<string, string>,
): string[] {
  const chunkTexts = chunks.get(docId)?.texts.filter(Boolean) ?? [];
  if (chunkTexts.length > 0) return chunkTexts;
  const fullText = texts.get(docId)?.trim();
  return fullText ? [fullText] : [];
}

/**
 * Provider-independent hybrid retrieval. All corpus state and embedding work
 * can be injected, so ranking is testable without workers or network access.
 */
export async function retrieveCorpus(
  query: string,
  options: RetrievalOptions = {},
  dependencies?: RetrievalDependencies,
): Promise<RetrievalHit[]> {
  const q = query.trim();
  if (!q) return [];

  const deps: RetrievalDependencies = dependencies ?? {
    nodes: useGraphStore.getState().nodes,
    chunks: defaultChunkStore,
    docVectors: defaultDocVectorStore,
    texts: defaultTextStore,
    embedQuery: defaultEmbedQuery,
  };
  const documentNodes = deps.nodes.filter((node) => node.kind === 'document');
  if (documentNodes.length === 0) return [];

  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const perDocument = Math.max(1, options.perDocument ?? DEFAULT_PER_DOCUMENT);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minSemanticScore = options.minSemanticScore ?? DEFAULT_MIN_SEMANTIC_SCORE;
  const maxPassageChars = options.maxPassageChars ?? DEFAULT_MAX_PASSAGE_CHARS;
  const candidates = new Map<string, Candidate>();

  // Lexical pass always runs, including when embeddings are unavailable.
  for (const node of documentNodes) {
    const passages = passagesForDocument(node.id, deps.chunks, deps.texts);
    for (let passageIndex = 0; passageIndex < passages.length; passageIndex++) {
      const text = passages[passageIndex];
      const lexical = lexicalRelevance(q, text, node.title);
      if (lexical.score <= 0) continue;
      upsertCandidate(candidates, {
        docId: node.id,
        docTitle: node.title,
        passageIndex,
        text: text.slice(0, maxPassageChars),
        lexicalScore: lexical.score,
        titleMatch: lexical.titleMatch,
      });
    }
  }

  // Semantic failure is an expected local-first degradation path.
  try {
    const queryVector = await withTimeout(deps.embedQuery(q), timeoutMs);
    const titleById = new Map(documentNodes.map((node) => [node.id, node.title]));
    const coveredByChunks = new Set<string>();

    for (const [docId, chunkData] of deps.chunks) {
      const vectors = chunkData.vectors;
      if (!vectors?.length) continue;
      const dims = chunkData.dims > 0 ? chunkData.dims : EMBED_DIMS;
      if (dims !== queryVector.length || vectors.length < dims) continue;
      coveredByChunks.add(docId);
      const chunkCount = Math.min(chunkData.texts.length, Math.floor(vectors.length / dims));
      for (let passageIndex = 0; passageIndex < chunkCount; passageIndex++) {
        const semanticScore = dotProduct(vectors, queryVector, passageIndex * dims, dims);
        if (semanticScore < minSemanticScore) continue;
        upsertCandidate(candidates, {
          docId,
          docTitle: titleById.get(docId) ?? docId.slice(0, 8),
          passageIndex,
          text: (chunkData.texts[passageIndex] ?? '').slice(0, maxPassageChars),
          semanticScore,
        });
      }
    }

    for (const [docId, vector] of deps.docVectors) {
      if (coveredByChunks.has(docId) || vector.length !== queryVector.length) continue;
      const semanticScore = dotProduct(vector, queryVector);
      if (semanticScore < minSemanticScore) continue;
      const text = deps.texts.get(docId) ?? '';
      upsertCandidate(candidates, {
        docId,
        docTitle: titleById.get(docId) ?? docId.slice(0, 8),
        passageIndex: 0,
        text: text.slice(0, maxPassageChars),
        semanticScore,
      });
    }
  } catch (error) {
    console.warn('[knowledge-nebula] semantic retrieval unavailable - lexical results only', error);
  }

  const semantic = [...candidates.values()]
    .filter((candidate) => candidate.semanticScore !== undefined)
    .sort((a, b) => (b.semanticScore ?? 0) - (a.semanticScore ?? 0) || a.id.localeCompare(b.id));
  const lexical = [...candidates.values()]
    .filter((candidate) => candidate.lexicalScore !== undefined)
    .sort((a, b) => (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0) || a.id.localeCompare(b.id));
  semantic.forEach((candidate, index) => { candidate.semanticRank = index + 1; });
  lexical.forEach((candidate, index) => { candidate.lexicalRank = index + 1; });

  const fused = reciprocalRankFusion([...candidates.values()]);
  return diversifyRanked(fused, limit, perDocument).map((candidate) => ({
    docId: candidate.docId,
    docTitle: candidate.docTitle,
    passageIndex: candidate.passageIndex,
    text: candidate.text,
    ...(candidate.semanticScore === undefined ? {} : { semanticScore: candidate.semanticScore }),
    ...(candidate.lexicalScore === undefined ? {} : { lexicalScore: candidate.lexicalScore }),
    ...(candidate.semanticRank === undefined ? {} : { semanticRank: candidate.semanticRank }),
    ...(candidate.lexicalRank === undefined ? {} : { lexicalRank: candidate.lexicalRank }),
    fusedScore: candidate.score,
    matchKind: candidate.titleMatch
      ? 'title'
      : candidate.semanticRank && candidate.lexicalRank
        ? 'hybrid'
        : candidate.semanticRank
          ? 'semantic'
          : 'keyword',
  }));
}
