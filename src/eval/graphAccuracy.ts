/**
 * Scoring helpers for the graph accuracy eval: compare a built graph (edges +
 * cluster assignment) against known ground truth. PURE functions — the eval
 * test owns corpus construction and the pipeline run.
 */

/** Order-independent key for an undirected document pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface PRScore {
  /** Distinct doc pairs the graph connected. */
  predicted: number;
  /** Distinct doc pairs the ground truth says are related. */
  expected: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Precision / recall of a set of predicted doc pairs against a set of
 * expected pairs. Both are deduplicated as undirected pairs; self-pairs are
 * ignored. An empty prediction scores precision 1 (nothing claimed wrongly).
 */
export function scorePairs(
  predicted: Iterable<{ source: string; target: string }>,
  expected: ReadonlySet<string>,
): PRScore {
  const pairs = new Set<string>();
  for (const { source, target } of predicted) {
    if (source !== target) pairs.add(pairKey(source, target));
  }
  let truePositives = 0;
  for (const key of pairs) if (expected.has(key)) truePositives += 1;
  const precision = pairs.size === 0 ? 1 : truePositives / pairs.size;
  const recall = expected.size === 0 ? 1 : truePositives / expected.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { predicted: pairs.size, expected: expected.size, truePositives, precision, recall, f1 };
}

export interface ClusterScore {
  clusters: number;
  classes: number;
  /** Share of docs that sit in their cluster's majority class (1 = no mixing). */
  purity: number;
  /** Share of docs that sit in their class's majority cluster (1 = no splitting). */
  inversePurity: number;
  /** Normalized mutual information, arithmetic-mean normalization (0..1). */
  nmi: number;
}

/**
 * Cluster quality against labelled classes. `clusters` and `labels` map the
 * same doc ids; ids missing from either side are skipped.
 */
export function scoreClusters(
  clusters: Readonly<Record<string, number>>,
  labels: ReadonlyMap<string, string>,
): ClusterScore {
  const joint = new Map<number, Map<string, number>>();
  const byCluster = new Map<number, number>();
  const byClass = new Map<string, number>();
  let n = 0;
  for (const [id, label] of labels) {
    const cluster = clusters[id];
    if (cluster === undefined) continue;
    n += 1;
    const row = joint.get(cluster) ?? new Map<string, number>();
    row.set(label, (row.get(label) ?? 0) + 1);
    joint.set(cluster, row);
    byCluster.set(cluster, (byCluster.get(cluster) ?? 0) + 1);
    byClass.set(label, (byClass.get(label) ?? 0) + 1);
  }
  if (n === 0) return { clusters: 0, classes: 0, purity: 0, inversePurity: 0, nmi: 0 };

  let purityHits = 0;
  for (const row of joint.values()) purityHits += Math.max(...row.values());

  const bestClusterPerClass = new Map<string, number>();
  for (const row of joint.values()) {
    for (const [label, count] of row) {
      bestClusterPerClass.set(label, Math.max(bestClusterPerClass.get(label) ?? 0, count));
    }
  }
  let inverseHits = 0;
  for (const count of bestClusterPerClass.values()) inverseHits += count;

  const entropy = (counts: Iterable<number>): number => {
    let h = 0;
    for (const c of counts) if (c > 0) h -= (c / n) * Math.log(c / n);
    return h;
  };
  let mutual = 0;
  for (const [cluster, row] of joint) {
    for (const [label, count] of row) {
      mutual += (count / n) * Math.log((n * count) / (byCluster.get(cluster)! * byClass.get(label)!));
    }
  }
  const hClusters = entropy(byCluster.values());
  const hClasses = entropy(byClass.values());
  const denom = (hClusters + hClasses) / 2;
  const nmi = denom === 0 ? 1 : mutual / denom;

  return {
    clusters: byCluster.size,
    classes: byClass.size,
    purity: purityHits / n,
    inversePurity: inverseHits / n,
    nmi,
  };
}
