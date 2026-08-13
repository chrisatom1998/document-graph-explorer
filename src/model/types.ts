/** Graph data model (spec §6) + pipeline message shapes. */

// Type-only imports of insight result shapes (erased at compile time, so the
// graph-module → types → graph-module cycle never exists at runtime): the
// insights worker's wire format and the pure functions must be the same type
// or they drift.
import type { ClusterStat } from '../graph/clusterStats';
import type { BridgeDoc, HubDoc } from '../graph/insights';

export type FileType =
  | 'md'
  | 'txt'
  | 'pdf'
  | 'html'
  | 'json'
  | 'yaml'
  | 'csv'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'code'
  | 'other';
export type NodeStatus = 'ok' | 'partial' | 'unreadable';
export type EdgeKind = 'reference' | 'semantic' | 'keyword' | 'entity' | 'topic';

export interface DocNode {
  id: string; // SHA-256 of path + content
  kind: 'document' | 'topic';
  title: string;
  fileType: FileType;
  path?: string;
  folderKey?: string; // layout hint only — never an edge
  summary?: string; // AI-enriched or first ~200 chars
  topics: string[]; // canonical (enriched) or TF-IDF fallback
  /**
   * Who last wrote `topics`. `tfidf` may be overwritten on the next lexical
   * pass; `gemini` (and legacy undefined + non-empty topics) is never clobbered
   * by the TF-IDF fallback.
   */
  topicsSource?: 'tfidf' | 'gemini';
  entities: string[];
  keywords: string[]; // raw TF-IDF top-N
  wordCount: number;
  cluster: number; // community id (-1 until Louvain runs)
  degree: number;
  status: NodeStatus;
  warning?: string; // e.g. "encrypted PDF"
  /** File mtime (epoch ms) captured at first ingest; absent for older cached docs. */
  lastModified?: number;
}

export interface Edge {
  id: string; // `${source}->${target}:${kind}`
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number; // 0..1
  /** Mandatory: every edge must answer "why are these connected?" (spec §6) */
  evidence: string[];
}

/**
 * A near-duplicate document pair by exact vector cosine, independent of
 * whether a semantic edge exists between them. A high-similarity pair can
 * miss the mutual-top-k edge rule when one side has many near-duplicates
 * crowding its top-k (see similarity.ts) — so this is computed separately
 * rather than derived from the edge set.
 */
export interface DuplicatePair {
  a: string;
  b: string;
  sim: number;
}

export interface GraphExport {
  version: 1;
  createdAt: string;
  generator: 'knowledge-nebula';
  includeEmbeddings: boolean;
  clusterNames?: Record<number, string>;
  nodes: DocNode[]; // embeddings never live on DocNode; see EmbeddingRecord
  edges: Edge[];
  /** base64 Float32 doc vectors, present only when includeEmbeddings */
  embeddings?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export interface IngestFile {
  fileId: string; // ephemeral per-drop id
  name: string;
  path?: string; // relative path when a folder was dropped
  fileType: FileType;
  bytes: ArrayBuffer;
  /** File.lastModified (epoch ms); absent for sources without an mtime (demo fetch). */
  lastModified?: number;
  /**
   * Deterministically reconstructable source (the generated demo corpus): its
   * exact bytes can be rebuilt on demand, so ingest skips persisting them as a
   * retained "original" — thousands of redundant IndexedDB writes avoided.
   */
  reconstructable?: boolean;
}

export type FileStage =
  | 'queued'
  | 'parsing'
  | 'embedding'
  | 'placed'
  | 'cached'
  | 'error';

export interface FileStatus {
  fileId: string;
  name: string;
  stage: FileStage;
  error?: string;
}

/** Why a file appears in the ingest report (spec: Phase B #13). */
export type IngestIssueKind =
  | 'ignored' // rejected before the pipeline: unsupported type, size limits
  | 'failed' // parse or embedding failure
  | 'skipped' // ingest cancelled before the file finished processing
  | 'capped'; // dropped at the MAX_NODES node limit

export interface IngestReportEntry {
  name: string;
  reason: string;
  kind: IngestIssueKind;
}

/**
 * Snapshot of every outstanding problem file, taken when an ingest run
 * settles. Persisted per corpus so it outlives the ProgressStrip's auto-hide.
 */
export interface IngestReport {
  finishedAt: number; // epoch ms
  entries: IngestReportEntry[];
}

export type PipelinePhase =
  | 'idle'
  | 'parsing'
  | 'linking' // lexical aggregation
  | 'embedding'
  | 'connecting' // semantic aggregation + clustering
  | 'enriching'
  | 'ready';

/** Long-running auxiliary work shown beneath the main pipeline progress. */
export type PipelineTaskProgress =
  | {
      kind: 'embedding-model';
      loaded: number; // bytes downloaded
      total: number; // total bytes when known
      note: string;
    }
  | {
      kind: 'ocr';
      loaded: number; // pages completed
      total: number; // pages selected for OCR
      note: string;
    };

// ---------------------------------------------------------------------------
// Parse / embed worker protocol
// ---------------------------------------------------------------------------

/** A hyperlink in a document: its visible label plus its URL/target. */
export interface LinkRef {
  text: string; // anchor / label text as it appeared ("" when unknown, e.g. PDFs)
  url: string; // the href / link target
}

export interface ParsedDoc {
  contentHash: string;
  title: string;
  text: string; // full extracted text (reader panel)
  wordCount: number;
  headings: string[];
  mdLinkTargets: string[]; // link URLs/paths found in the doc (feeds reference edges)
  docLinks: LinkRef[]; // labelled links for the reader view (label ↔ url pairing)
  entities: string[];
  tf: Record<string, number>; // term frequency (tokenized)
  /** RAKE-style 2..3-gram counts; keys contain spaces (no unigram collision). */
  phraseTf: Record<string, number>;
  totalTerms: number;
  chunks: string[]; // pre-chunked for embedding
  /** Extractive TextRank summary computed in the worker; '' when nothing usable. */
  summary: string;
  status: NodeStatus;
  warning?: string;
}

export type PoolRequest =
  | {
      requestId: number;
      type: 'parse';
      fileId: string;
      name: string;
      path?: string;
      fileType: FileType;
      bytes: ArrayBuffer;
    }
  | {
      // pre-extracted text (e.g. pdf.js runs on the main thread); worker does
      // tokenize/entities/wordCount only
      requestId: number;
      type: 'analyze';
      fileId: string;
      name: string;
      path?: string;
      fileType: FileType;
      docId: string;
      title: string;
      text: string;
      status: NodeStatus;
      warning?: string;
    }
  | { requestId: number; type: 'embed'; docId: string; chunks: string[] }
  | {
      // Batched embedding: many documents' chunks in one worker round trip.
      // The worker packs chunks across doc boundaries into model-sized
      // batches, so single-chunk docs no longer each pay a full inference
      // call. Order of `docs` is preserved in the response.
      requestId: number;
      type: 'embedBatch';
      docs: { docId: string; chunks: string[] }[];
    }
  | { requestId: number; type: 'embedQuery'; text: string };

export type PoolResponse =
  | { requestId: number; type: 'parse:done'; fileId: string; doc: ParsedDoc }
  | {
      requestId: number;
      type: 'embed:done';
      docId: string;
      docVector: Float32Array;
      chunkVectors: Float32Array; // flattened [nChunks * dims]
      nChunks: number;
    }
  | {
      requestId: number;
      type: 'embedBatch:done';
      docs: {
        docId: string;
        docVector: Float32Array;
        chunkVectors: Float32Array; // flattened [nChunks * dims]
        nChunks: number;
      }[];
    }
  | { requestId: number; type: 'embedQuery:done'; vector: Float32Array }
  | { requestId: number; type: 'model:progress'; loaded: number; total: number; note: string }
  | { requestId: number; type: 'error'; message: string; fileId?: string };

// ---------------------------------------------------------------------------
// Aggregator worker protocol
// ---------------------------------------------------------------------------

export interface LexicalDocInput {
  id: string;
  title: string;
  fileName: string; // for mention matching
  /** Folder-relative path when known; used to resolve ./imports. */
  path?: string;
  tf: Record<string, number>;
  phraseTf: Record<string, number>;
  totalTerms: number;
  textLower: string; // capped, for title-mention scan + boilerplate
  mdLinkTargets: string[];
  entities: string[]; // for shared-entity edges (entityLinks.ts)
}

export type AggRequest =
  | {
      requestId: number;
      type: 'lexical';
      docs: LexicalDocInput[];
      params: {
        tfidfTopN: number;
        minShared: number;
        edgesPerDoc: number;
        minTitleLen: number;
        entityMinShared: number;
        entityEdgesPerDoc: number;
      };
    }
  | {
      requestId: number;
      type: 'semantic';
      ids: string[];
      vectors: Float32Array; // flattened [n * dims]
      dims: number;
      existingEdges: { source: string; target: string; weight: number }[];
      params: { threshold: number; topK: number; dupThreshold: number };
    }
  | {
      // Clustering-only pass: Louvain over a caller-supplied edge set, no
      // vectors/similarity computation. Used by the incremental semantic
      // path (pipeline/coordinator.ts), which computes new-vs-existing
      // similarity pairs itself and only needs the worker to re-run
      // community detection over the resulting (small) edge set.
      requestId: number;
      type: 'cluster';
      ids: string[];
      edges: { source: string; target: string; weight: number }[];
    };

export type AggResponse =
  | {
      requestId: number;
      type: 'lexical:done';
      keywordsByDoc: Record<string, string[]>;
      edges: Edge[];
      boilerplateLines: string[];
    }
  | {
      requestId: number;
      type: 'semantic:done';
      edges: Edge[]; // semantic edges only
      clusters: Record<string, number>; // docId -> community (over full edge set)
      duplicates: DuplicatePair[]; // pairs >= dupThreshold, independent of the edge set
      /** Per-doc bounded top-k candidates, indices into the request's `ids` —
       * cached by the caller so the next incremental pass can skip the full
       * O(n²) rescan (see similarity.ts's SemanticIndex). */
      top: { j: number; sim: number }[][];
    }
  | { requestId: number; type: 'cluster:done'; clusters: Record<string, number> }
  | { requestId: number; type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Insights worker protocol
// ---------------------------------------------------------------------------

/**
 * Slimmed node copy shipped to the insights worker — everything the pure
 * functions read and nothing else (no titles/summaries/text; structured-
 * cloning those for a 4k-node corpus would cost more than the analysis).
 * `kind` is load-bearing: computeBridges/computeHubs filter on it, so
 * without it every node looks like a non-document and the results are empty.
 */
export interface InsightsNodeInput {
  id: string;
  kind: 'document' | 'topic';
  cluster: number;
  keywords: string[];
}

export interface InsightsEdgeInput {
  source: string;
  target: string;
  weight: number;
  kind: EdgeKind;
}

export interface InsightsRequest {
  requestId: number;
  type: 'insights';
  nodes: InsightsNodeInput[];
  edges: InsightsEdgeInput[];
}

export type InsightsResponse =
  | {
      requestId: number;
      type: 'insights:done';
      bridges: BridgeDoc[];
      hubs: HubDoc[];
      clusterStats: ClusterStat[];
    }
  | { requestId: number; type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Layout worker protocol
// ---------------------------------------------------------------------------

export interface LayoutNodeInput {
  id: string;
  slot: number;
  cluster: number;
  spawn?: [number, number, number];
  initial?: [number, number, number]; // exact restore position (cache path)
}

export type LayoutRequest =
  | { type: 'add'; nodes: LayoutNodeInput[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'links'; links: { source: string; target: string; weight: number }[] }
  | { type: 'clusters'; clusterOf: Record<string, number> }
  | { type: 'reheat'; alpha: number }
  | { type: 'pin'; id: string; x: number; y: number; z: number }
  | { type: 'unpin'; id: string }
  | { type: 'setDims'; dims: 2 | 3 }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'returnBuffer'; buffer: ArrayBuffer };

export type LayoutResponse =
  | { type: 'tick'; buffer: ArrayBuffer; count: number; alpha: number }
  | { type: 'settled' };
