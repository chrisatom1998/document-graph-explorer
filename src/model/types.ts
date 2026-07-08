/** Graph data model (spec §6) + pipeline message shapes. */

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
  summary?: string; // Gemini or first ~200 chars
  topics: string[]; // canonical (enriched) or TF-IDF fallback
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

export type PipelinePhase =
  | 'idle'
  | 'parsing'
  | 'linking' // lexical aggregation
  | 'embedding'
  | 'connecting' // semantic aggregation + clustering
  | 'enriching'
  | 'ready';

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
  totalTerms: number;
  chunks: string[]; // pre-chunked for embedding
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
  tf: Record<string, number>;
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
