/**
 * Quantitative (and visual) diff between two graphs — typically a saved
 * snapshot vs the current graph. Pure data-in/data-out.
 *
 * Identity subtleties:
 * - A document's node id is content-derived (SHA-256 of path + content), so
 *   editing a file produces a REMOVED old id plus an ADDED new id. Raw id
 *   diffing would report every edit as one removal and one addition. Instead,
 *   removed and added docs are paired by their stable key (path, falling back
 *   to title) and each pair is reported as one UPDATED document.
 * - Edge ids embed node ids, so every edge touching an edited document also
 *   changes id even when the relationship persisted. Edges are therefore
 *   compared by an endpoint-KEY signature, not by edge id — an updated doc
 *   that kept its connections contributes zero edge churn.
 */

import type { DocNode, Edge } from '../model/types';

export interface GraphSlice {
  nodes: DocNode[];
  edges: Edge[];
}

export interface GraphDiffSummary {
  docsBefore: number;
  docsAfter: number;
  addedDocs: number;
  removedDocs: number;
  updatedDocs: number;
  addedEdges: number;
  removedEdges: number;
  /** Current-graph ids for documents that were not in the snapshot. */
  addedIds: string[];
  /** Current-graph ids for documents whose content changed (same path/title). */
  updatedIds: string[];
  /** Labels for documents that exist only in the snapshot (not in the live graph). */
  removedLabels: string[];
}

/** Stable identity for pairing a document across content edits. */
function docKey(node: DocNode): string {
  return node.path ?? node.title;
}

function documentsOf(slice: GraphSlice): DocNode[] {
  return slice.nodes.filter((n) => n.kind === 'document');
}

function sameEndpointPair(a: string, b: string, x: string, y: string): boolean {
  return (a === x && b === y) || (a === y && b === x);
}

/** Multiset of edge signatures keyed by endpoint doc-keys + kind. */
function edgeSignatures(slice: GraphSlice): Map<string, number> {
  const keyById = new Map<string, string>();
  for (const node of slice.nodes) keyById.set(node.id, docKey(node));
  const signatures = new Map<string, number>();
  for (const edge of slice.edges) {
    const a = keyById.get(edge.source);
    const b = keyById.get(edge.target);
    if (a === undefined || b === undefined) continue; // dangling edge — skip
    // Direction is not meaningful for "are these still connected?" — collapse.
    const sig = `${a}::${b}::${edge.kind}`;
    signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
  }
  return signatures;
}

export function diffGraphs(before: GraphSlice, after: GraphSlice): GraphDiffSummary {
  const beforeDocs = documentsOf(before);
  const afterDocs = documentsOf(after);
  const beforeIds = new Set(beforeDocs.map((d) => d.id));
  const afterIds = new Set(afterDocs.map((d) => d.id));

  const removedByKey = new Map<string, DocNode[]>();
  for (const doc of beforeDocs) {
    if (afterIds.has(doc.id)) continue;
    const list = removedByKey.get(docKey(doc)) ?? [];
    list.push(doc);
    removedByKey.set(docKey(doc), list);
  }

  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  for (const doc of afterDocs) {
    if (beforeIds.has(doc.id)) continue;
    const pending = removedByKey.get(docKey(doc));
    if (pending && pending.length > 0) {
      pending.shift();
      updatedIds.push(doc.id);
    } else {
      addedIds.push(doc.id);
    }
  }
  const removedLabels: string[] = [];
  for (const leftover of removedByKey.values()) {
    for (const doc of leftover) removedLabels.push(doc.title);
  }

  const beforeSigs = edgeSignatures(before);
  const afterSigs = edgeSignatures(after);
  let addedEdges = 0;
  let removedEdges = 0;
  for (const [sig, count] of afterSigs) {
    const [a, b, kind] = sig.split('::');
    let beforeCount = 0;
    for (const [beforeSig, beforeValue] of beforeSigs) {
      const [x, y, beforeKind] = beforeSig.split('::');
      if (beforeKind !== kind) continue;
      if (!sameEndpointPair(a, b, x, y)) continue;
      beforeCount += beforeValue;
    }
    addedEdges += Math.max(0, count - beforeCount);
  }
  for (const [sig, count] of beforeSigs) {
    const [a, b, kind] = sig.split('::');
    let afterCount = 0;
    for (const [afterSig, afterValue] of afterSigs) {
      const [x, y, afterKind] = afterSig.split('::');
      if (afterKind !== kind) continue;
      if (!sameEndpointPair(a, b, x, y)) continue;
      afterCount += afterValue;
    }
    removedEdges += Math.max(0, count - afterCount);
  }

  return {
    docsBefore: beforeDocs.length,
    docsAfter: afterDocs.length,
    addedDocs: addedIds.length,
    removedDocs: removedLabels.length,
    updatedDocs: updatedIds.length,
    addedEdges,
    removedEdges,
    addedIds,
    updatedIds,
    removedLabels,
  };
}

/** Human-readable one-liner, e.g. "+4 docs, −1 doc, 2 updated, +12/−3 connections". */
export function formatDiffSummary(diff: GraphDiffSummary): string {
  const parts: string[] = [];
  if (diff.addedDocs) parts.push(`+${diff.addedDocs} doc${diff.addedDocs === 1 ? '' : 's'}`);
  if (diff.removedDocs)
    parts.push(`−${diff.removedDocs} doc${diff.removedDocs === 1 ? '' : 's'}`);
  if (diff.updatedDocs) parts.push(`${diff.updatedDocs} updated`);
  if (diff.addedEdges || diff.removedEdges)
    parts.push(`+${diff.addedEdges}/−${diff.removedEdges} connections`);
  return parts.length ? parts.join(', ') : 'No changes';
}
