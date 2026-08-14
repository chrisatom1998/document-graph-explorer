/**
 * Closest semantic neighbors for orphan documents — docs with no
 * document-to-document edge, but a cosine that almost (or even did)
 * clear SIM_THRESHOLD without becoming a mutual top-k edge.
 *
 * PURE over id lists + unit vectors so Insights can unit-test ranking
 * without the runtime stores.
 */

/** Floor below which "similar" is noise, not a suggested link. */
export const ORPHAN_NEIGHBOR_MIN_SIM = 0.25;

export interface OrphanNeighbor {
  orphanId: string;
  neighborId: string;
  sim: number;
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += a[i] * b[i];
  return d;
}

/**
 * One nearest neighbor per orphan. Neighbors at or above SIM_THRESHOLD are
 * kept: an orphan by definition has no edge, so a high score means the pair
 * was crowded out of mutual top-k — still a suggested link. Below-threshold
 * scores are the common case ("not connected, but 0.58 similar").
 */
export function nearestOrphanNeighbors(
  orphanIds: readonly string[],
  vectors: ReadonlyMap<string, Float32Array>,
  allDocIds: readonly string[],
  opts?: { minSim?: number },
): OrphanNeighbor[] {
  const minSim = opts?.minSim ?? ORPHAN_NEIGHBOR_MIN_SIM;
  const out: OrphanNeighbor[] = [];
  for (const orphanId of orphanIds) {
    const va = vectors.get(orphanId);
    if (!va) continue;
    let bestId: string | null = null;
    let bestSim = minSim;
    for (const otherId of allDocIds) {
      if (otherId === orphanId) continue;
      const vb = vectors.get(otherId);
      if (!vb) continue;
      const sim = cosine(va, vb);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = otherId;
      }
    }
    if (bestId) out.push({ orphanId, neighborId: bestId, sim: bestSim });
  }
  return out;
}
