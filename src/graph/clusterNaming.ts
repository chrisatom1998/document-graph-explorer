/**
 * Local (no-network) cluster naming — the middle tier of the cluster-label
 * fallback chain: clusterNames (Gemini) ?? localClusterNames ?? "Cluster N".
 *
 * Names each Louvain community from keywords its documents already carry, so
 * clusters read as "Auth & Tokens" instead of "Cluster 3" even without an API
 * key. Each keyword is scored per cluster as
 *
 *   inClusterDocFreq * log(1 + totalDocs / (1 + globalDocFreq))
 *
 * — how many of the cluster's docs mention it, damped by corpus-level
 * distinctiveness, so a term that appears in every document corpus-wide
 * cannot end up naming every cluster. Colliding names are disambiguated by
 * extending each cluster with its next-best keyword; a cluster that still
 * collides after that gets no entry (the UI's "Cluster N" fallback is better
 * than two clusters wearing the same label).
 *
 * PURE function over nodes — unit-testable, no store or DOM imports.
 */

import type { DocNode } from '../model/types';

/** Soft cap on label length: drop the second keyword rather than truncate. */
const MAX_NAME_LENGTH = 32;

function titleCase(term: string): string {
  return term
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Derive a human-readable name per cluster id from member-document keywords.
 * Clusters whose documents carry no keywords (and no topics) get no entry.
 */
export function computeLocalClusterNames(nodes: DocNode[]): Record<number, string> {
  const docs = nodes.filter((n) => n.kind === 'document' && n.cluster >= 0);
  const totalDocs = docs.length;
  if (totalDocs === 0) return {};

  // Document frequencies, corpus-wide and per cluster. A doc's keyword source
  // is its TF-IDF keywords, falling back to topics when extraction produced
  // none. Deduped per doc so a repeated term still counts as one document.
  const globalDf = new Map<string, number>();
  const clusterDf = new Map<number, Map<string, number>>();
  for (const doc of docs) {
    const source = doc.keywords.length > 0 ? doc.keywords : doc.topics;
    const seen = new Set<string>();
    for (const raw of source) {
      const kw = raw.trim().toLowerCase();
      if (kw) seen.add(kw);
    }
    let perCluster = clusterDf.get(doc.cluster);
    if (!perCluster) {
      perCluster = new Map();
      clusterDf.set(doc.cluster, perCluster);
    }
    for (const kw of seen) {
      globalDf.set(kw, (globalDf.get(kw) ?? 0) + 1);
      perCluster.set(kw, (perCluster.get(kw) ?? 0) + 1);
    }
  }

  // Rank each cluster's keywords: in-cluster frequency × distinctiveness,
  // ties broken alphabetically so naming is deterministic run to run.
  const ranked = new Map<number, string[]>();
  for (const [cluster, df] of clusterDf) {
    const scored = [...df.entries()].map(([kw, inClusterDocFreq]) => ({
      kw,
      score: inClusterDocFreq * Math.log(1 + totalDocs / (1 + (globalDf.get(kw) ?? 0))),
    }));
    scored.sort((a, b) => b.score - a.score || a.kw.localeCompare(b.kw));
    ranked.set(cluster, scored.map((s) => s.kw));
  }

  // Base name: top two keywords joined with " & ", dropping the second when
  // the joined label would blow past the cap — whole keywords only, never a
  // mid-word truncation.
  const nameOf = new Map<number, string>();
  const usedCount = new Map<number, number>(); // keywords consumed per cluster
  for (const [cluster, kws] of ranked) {
    if (kws.length === 0) continue;
    let name = titleCase(kws[0]);
    let used = 1;
    if (kws.length > 1) {
      const two = `${name} & ${titleCase(kws[1])}`;
      if (two.length <= MAX_NAME_LENGTH) {
        name = two;
        used = 2;
      }
    }
    nameOf.set(cluster, name);
    usedCount.set(cluster, used);
  }

  // Collision pass: clusters that landed on the same label each append their
  // next-best unused keyword ("Auth" → "Auth & Tokens" vs "Auth & Sessions").
  // Disambiguation may exceed the length cap — an over-long unique label
  // beats two identical ones.
  const byName = new Map<string, number[]>();
  for (const [cluster, name] of nameOf) {
    const group = byName.get(name);
    if (group) group.push(cluster);
    else byName.set(name, [cluster]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const cluster of group) {
      const kws = ranked.get(cluster)!;
      const used = usedCount.get(cluster)!;
      if (used >= kws.length) continue; // nothing left to disambiguate with
      nameOf.set(cluster, `${nameOf.get(cluster)!} & ${titleCase(kws[used])}`);
      usedCount.set(cluster, used + 1);
    }
  }

  // Final dedupe: if names are still identical after one extension round,
  // the lowest cluster id keeps the label and later ones get no entry.
  const out: Record<number, string> = {};
  const taken = new Set<string>();
  for (const cluster of [...nameOf.keys()].sort((a, b) => a - b)) {
    const name = nameOf.get(cluster)!;
    if (taken.has(name)) continue;
    taken.add(name);
    out[cluster] = name;
  }
  return out;
}
