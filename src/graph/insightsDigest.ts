/**
 * One-shot "what we found" summary after ingest settles. Cheap scans only —
 * orphans, near-duplicates, cluster count, stale docs — so the digest can
 * fire on the main thread the moment phase becomes `ready` without waiting
 * for the insights worker (bridges/hubs).
 */

import type { DocNode, DuplicatePair, Edge, PipelinePhase } from '../model/types';
import { computeOrphans, computeStaleDocs } from './insights';
import { STALE_DOC_DAYS } from '../config';

/** Pipeline phases that mean a real ingest/relink just ran (not restore or enrichment). */
export const INGEST_PHASES: ReadonlySet<PipelinePhase> = new Set([
  'parsing',
  'linking',
  'embedding',
  'connecting',
]);

export interface InsightsDigest {
  docCount: number;
  clusterCount: number;
  orphanCount: number;
  duplicateCount: number;
  staleCount: number;
  orphanIds: string[];
  duplicateIds: string[];
  staleIds: string[];
}

export function summarizeInsights(
  nodes: DocNode[],
  edges: Edge[],
  duplicatePairs: DuplicatePair[],
  nowMs: number = Date.now(),
): InsightsDigest {
  const docs = nodes.filter((n) => n.kind === 'document');
  const clusters = new Set<number>();
  for (const n of docs) {
    if (n.cluster >= 0) clusters.add(n.cluster);
  }
  const orphanIds = computeOrphans(nodes, edges);
  const duplicateIds = [...new Set(duplicatePairs.flatMap((d) => [d.a, d.b]))];
  const staleIds = computeStaleDocs(nodes, nowMs, STALE_DOC_DAYS).map((d) => d.id);
  return {
    docCount: docs.length,
    clusterCount: clusters.size,
    orphanCount: orphanIds.length,
    duplicateCount: duplicatePairs.length,
    staleCount: staleIds.length,
    orphanIds,
    duplicateIds,
    staleIds,
  };
}

export function formatInsightsDigest(digest: InsightsDigest): string {
  const clusters = `${digest.clusterCount} ${digest.clusterCount === 1 ? 'cluster' : 'clusters'}`;
  const orphans = `${digest.orphanCount} ${digest.orphanCount === 1 ? 'orphan' : 'orphans'}`;
  const dups = `${digest.duplicateCount} near-${digest.duplicateCount === 1 ? 'duplicate' : 'duplicates'}`;
  return `${clusters} · ${orphans} · ${dups}`;
}

/**
 * Skip the card when ingest found nothing the user would not already see:
 * a single well-connected cluster with no orphans, duplicates, or stale docs.
 */
export function shouldOfferInsightsDigest(digest: InsightsDigest): boolean {
  if (digest.docCount === 0) return false;
  return (
    digest.orphanCount > 0 ||
    digest.duplicateCount > 0 ||
    digest.clusterCount > 1 ||
    digest.staleCount > 0
  );
}

export function isIngestPhase(phase: PipelinePhase): boolean {
  return INGEST_PHASES.has(phase);
}
