/**
 * Sanitizer for untrusted GraphExport JSON (the shared-file import path).
 *
 * Imported files come from outside the app — every field that reaches React,
 * the layout worker, or IndexedDB is type-checked, clamped, or dropped here,
 * so a crafted file can at worst import less data. Without this, a non-string
 * node title crashes the React tree, a dangling edge crashes the d3-force
 * link initializer, and an oversized embeddings blob exhausts tab memory —
 * and a bad import can be snapshotted into IndexedDB, re-crashing every load.
 *
 * PURE — no store or DOM access, unit-tested in validateImport.test.ts.
 */

import { MAX_NODES } from '../config';
import type {
  DocNode,
  Edge,
  EdgeKind,
  FileType,
  GraphExport,
  NodeStatus,
} from '../model/types';

export const MAX_IMPORT_EDGES = MAX_NODES * 8;
/** 384 float32 dims → 1536 bytes → 2048 base64 chars; leave slack, reject blobs. */
export const MAX_EMBEDDING_B64_CHARS = 8192;

const MAX_ID_CHARS = 256;
const MAX_TITLE_CHARS = 300;
const MAX_TEXT_CHARS = 2000; // summary / warning
const MAX_PATH_CHARS = 1024;
const MAX_LIST_ITEMS = 64; // topics / entities / keywords / evidence
const MAX_LIST_ITEM_CHARS = 200;
const MAX_CLUSTER_NAMES = 1024;

// Must mirror the FileType union in model/types.ts, or exporting then
// reimporting a graph downgrades known file types to 'other'.
const FILE_TYPES: ReadonlySet<string> = new Set([
  'md',
  'txt',
  'pdf',
  'html',
  'json',
  'yaml',
  'csv',
  'docx',
  'pptx',
  'xlsx',
  'other',
]);
const NODE_STATUSES: ReadonlySet<string> = new Set(['ok', 'partial', 'unreadable']);
const EDGE_KINDS: ReadonlySet<string> = new Set([
  'reference',
  'semantic',
  'keyword',
  'entity',
  'topic',
]);

function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    out.push(item.length > MAX_LIST_ITEM_CHARS ? item.slice(0, MAX_LIST_ITEM_CHARS) : item);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function sanitizeNode(raw: unknown): DocNode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const n = raw as Record<string, unknown>;
  const id = asString(n.id, MAX_ID_CHARS);
  if (!id) return null;

  const title = asString(n.title, MAX_TITLE_CHARS)?.trim();
  const summary = asString(n.summary, MAX_TEXT_CHARS);
  const warning = asString(n.warning, MAX_TEXT_CHARS);
  const path = asString(n.path, MAX_PATH_CHARS);
  const folderKey = asString(n.folderKey, MAX_PATH_CHARS);

  const node: DocNode = {
    id,
    kind: n.kind === 'topic' ? 'topic' : 'document',
    title: title || id.slice(0, 12),
    fileType:
      typeof n.fileType === 'string' && FILE_TYPES.has(n.fileType)
        ? (n.fileType as FileType)
        : 'other',
    topics: asStringList(n.topics),
    entities: asStringList(n.entities),
    keywords: asStringList(n.keywords),
    wordCount: asCount(n.wordCount),
    cluster:
      typeof n.cluster === 'number' && Number.isFinite(n.cluster) ? Math.trunc(n.cluster) : -1,
    degree: asCount(n.degree),
    status:
      typeof n.status === 'string' && NODE_STATUSES.has(n.status)
        ? (n.status as NodeStatus)
        : 'ok',
  };
  if (path !== null) node.path = path;
  if (folderKey !== null) node.folderKey = folderKey;
  if (summary !== null) node.summary = summary;
  if (warning !== null) node.warning = warning;
  if (
    typeof n.lastModified === 'number' &&
    Number.isFinite(n.lastModified) &&
    n.lastModified > 0
  ) {
    node.lastModified = n.lastModified;
  }
  return node;
}

function sanitizeEdge(raw: unknown, nodeIds: ReadonlySet<string>): Edge | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const source = asString(e.source, MAX_ID_CHARS);
  const target = asString(e.target, MAX_ID_CHARS);
  if (!source || !target || source === target) return null;
  // Dangling endpoints crash the layout worker's link initializer.
  if (!nodeIds.has(source) || !nodeIds.has(target)) return null;

  const kind: EdgeKind =
    typeof e.kind === 'string' && EDGE_KINDS.has(e.kind) ? (e.kind as EdgeKind) : 'reference';
  const weight =
    typeof e.weight === 'number' && Number.isFinite(e.weight)
      ? Math.min(1, Math.max(0, e.weight))
      : 0.5;
  return {
    id: asString(e.id, 2 * MAX_ID_CHARS + 32) ?? `${source}->${target}:${kind}`,
    source,
    target,
    kind,
    weight,
    evidence: asStringList(e.evidence),
  };
}

/**
 * Validate + sanitize untrusted import data into a well-formed GraphExport.
 * Throws a descriptive Error (message is shown to the user) when the file is
 * structurally unusable; individually malformed nodes/edges are dropped.
 */
export function sanitizeGraphExport(data: unknown): GraphExport {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Import failed: file does not contain a JSON object.');
  }
  const g = data as Record<string, unknown>;
  if (g.version !== 1) {
    throw new Error(
      `Import failed: unsupported export version (${String(g.version ?? 'missing')}) — expected 1.`,
    );
  }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error('Import failed: "nodes" and "edges" arrays are missing or malformed.');
  }
  if (g.nodes.length > MAX_NODES) {
    throw new Error(
      `Import failed: export contains ${g.nodes.length} nodes — the maximum is ${MAX_NODES}.`,
    );
  }

  const nodes: DocNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of g.nodes) {
    const node = sanitizeNode(raw);
    if (!node || nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    nodes.push(node);
  }
  if (nodes.length === 0) throw new Error('Import failed: export contains no valid nodes.');

  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of g.edges) {
    if (edges.length >= MAX_IMPORT_EDGES) break;
    const edge = sanitizeEdge(raw, nodeIds);
    if (!edge || edgeIds.has(edge.id)) continue;
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  const clusterNames: Record<number, string> = {};
  if (
    typeof g.clusterNames === 'object' &&
    g.clusterNames !== null &&
    !Array.isArray(g.clusterNames)
  ) {
    let kept = 0;
    for (const [key, value] of Object.entries(g.clusterNames)) {
      if (kept >= MAX_CLUSTER_NAMES) break;
      const clusterId = Number(key);
      const name = asString(value, MAX_LIST_ITEM_CHARS)?.trim();
      if (!Number.isFinite(clusterId) || !name) continue;
      clusterNames[Math.trunc(clusterId)] = name;
      kept++;
    }
  }

  // Keep only plausible base64 strings for known nodes; decoding and the
  // EMBED_DIMS length check stay with the caller.
  let embeddings: Record<string, string> | undefined;
  if (typeof g.embeddings === 'object' && g.embeddings !== null && !Array.isArray(g.embeddings)) {
    embeddings = {};
    for (const [id, b64] of Object.entries(g.embeddings)) {
      if (!nodeIds.has(id)) continue;
      if (typeof b64 !== 'string' || b64.length === 0 || b64.length > MAX_EMBEDDING_B64_CHARS) {
        continue;
      }
      embeddings[id] = b64;
    }
  }

  const out: GraphExport = {
    version: 1,
    createdAt: asString(g.createdAt, 64) ?? '',
    generator: 'knowledge-nebula',
    includeEmbeddings: g.includeEmbeddings === true,
    clusterNames,
    nodes,
    edges,
  };
  if (embeddings) out.embeddings = embeddings;
  return out;
}
