/**
 * Closest semantic neighbors for orphan documents — docs with no
 * document-to-document edge, but a cosine that almost (or even did)
 * clear SIM_THRESHOLD without becoming a mutual top-k edge.
 *
 * The expensive ranking happens during the pipeline's existing semantic
 * pass. This helper only filters that retained result for the current orphan
 * ids, keeping React rendering proportional to the number of rows shown.
 */

import type { SemanticNeighbor } from '../model/types';

/** Floor below which "similar" is noise, not a suggested link. */
export const ORPHAN_NEIGHBOR_MIN_SIM = 0.25;

export interface OrphanNeighbor {
  orphanId: string;
  neighborId: string;
  sim: number;
}

/**
 * One retained nearest neighbor per orphan. Scores below the noise floor are
 * omitted; scores below the connection threshold are intentionally kept.
 */
export function nearestOrphanNeighbors(
  orphanIds: readonly string[],
  semanticNeighbors: readonly SemanticNeighbor[],
  opts?: { minSim?: number },
): OrphanNeighbor[] {
  const minSim = opts?.minSim ?? ORPHAN_NEIGHBOR_MIN_SIM;
  const orphanSet = new Set(orphanIds);
  return semanticNeighbors
    .filter((candidate) => orphanSet.has(candidate.id) && candidate.sim > minSim)
    .map((candidate) => ({
      orphanId: candidate.id,
      neighborId: candidate.neighborId,
      sim: candidate.sim,
    }));
}
