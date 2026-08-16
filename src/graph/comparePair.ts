/**
 * Local relationship summary for two documents. No LLM, no store imports —
 * callers pass nodes, edges, and optional embeddings so this stays unit-testable.
 */

import { DUP_SIM_THRESHOLD } from '../config';
import type { DocNode, Edge, EdgeKind } from '../model/types';

export interface ComparePairInput {
  left: DocNode;
  right: DocNode;
  edges: readonly Edge[];
  leftVector?: Float32Array;
  rightVector?: Float32Array;
  dupThreshold?: number;
}

export interface CompareEdge {
  id: string;
  kind: EdgeKind;
  weight: number;
  evidence: string[];
}

export interface CompareSummary {
  similarity: number | null;
  nearDuplicate: boolean;
  sharedTopics: string[];
  sharedEntities: string[];
  sharedKeywords: string[];
  edges: CompareEdge[];
}

function cosine(a: Float32Array, b: Float32Array): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Case-insensitive intersection; keeps the left-hand casing and first-seen order. */
export function intersectLabels(left: readonly string[], right: readonly string[]): string[] {
  const rightKeys = new Set<string>();
  for (const item of right) {
    const key = item.trim().toLowerCase();
    if (key) rightKeys.add(key);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of left) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key) || !rightKeys.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function pairEdges(leftId: string, rightId: string, edges: readonly Edge[]): CompareEdge[] {
  const out: CompareEdge[] = [];
  for (const edge of edges) {
    const matches =
      (edge.source === leftId && edge.target === rightId) ||
      (edge.source === rightId && edge.target === leftId);
    if (!matches) continue;
    out.push({ id: edge.id, kind: edge.kind, weight: edge.weight, evidence: edge.evidence });
  }
  out.sort((a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind));
  return out;
}

export function comparePair(input: ComparePairInput): CompareSummary {
  const threshold = input.dupThreshold ?? DUP_SIM_THRESHOLD;
  const similarity =
    input.leftVector && input.rightVector
      ? cosine(input.leftVector, input.rightVector)
      : null;
  return {
    similarity,
    nearDuplicate: similarity !== null && similarity >= threshold,
    sharedTopics: intersectLabels(input.left.topics, input.right.topics),
    sharedEntities: intersectLabels(input.left.entities, input.right.entities),
    sharedKeywords: intersectLabels(input.left.keywords, input.right.keywords),
    edges: pairEdges(input.left.id, input.right.id, input.edges),
  };
}
