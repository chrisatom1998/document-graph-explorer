/**
 * Pure helpers for the dedicated path-route overlay. PathPanel still feeds
 * the hop list through uiStore.searchResults (owner 'path') so the rest of
 * the graph can dim; these helpers turn that ordered id list into undirected
 * hop keys the scene can match against edges.
 */

export function undirectedHopKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Consecutive pairs along an ordered path (empty when fewer than 2 ids). */
export function pathHopPairs(ids: string[] | null | undefined): [string, string][] {
  if (!ids || ids.length < 2) return [];
  const hops: [string, string][] = [];
  for (let i = 0; i < ids.length - 1; i++) hops.push([ids[i], ids[i + 1]]);
  return hops;
}

export function pathHopSet(ids: string[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const [a, b] of pathHopPairs(ids)) set.add(undirectedHopKey(a, b));
  return set;
}

export function isPathHop(source: string, target: string, hops: Set<string>): boolean {
  return hops.has(undirectedHopKey(source, target));
}
