import type { DocNode, Edge } from '../model/types';

const GENERIC = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'file', 'filename', 'same', 'copy', 'version', 'vol', 'volume', 'audio', 'sample', 'track', 'document', 'untitled']);
const MAX_PHRASES = 8;
/** Adjacent descriptive words only: pack IDs, key tags and numbers break phrases. */
export function titlePhrases(title: string): string[] {
  const words = title.normalize('NFKC').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/, '').split(/[\s_()[\]{}./\\-]+/);
  const normalized = words.map(word => {
    if (!/^[a-z]{2,}$/.test(word) || /^[a-g](?:maj|min|m)$/.test(word)) return '';
    const singular = word.endsWith('s') && !word.endsWith('ss') && word.length > 3 ? word.slice(0, -1) : word;
    return GENERIC.has(singular) ? '' : singular;
  });
  const phrases = new Set<string>();
  for (let i = 1; i < normalized.length && phrases.size < MAX_PHRASES; i++) {
    if (normalized[i - 1] && normalized[i]) phrases.add(`${normalized[i - 1]} ${normalized[i]}`);
  }
  return [...phrases];
}

/** A small group is fully linked; large groups stay connected with bounded edges. */
export function buildTitleEdges(nodes: DocNode[]): Edge[] {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.kind !== 'document') continue;
    for (const phrase of titlePhrases(node.title)) {
      const ids = groups.get(phrase) ?? [];
      ids.push(node.id); groups.set(phrase, ids);
    }
  }
  const edges = new Map<string, Edge>();
  for (const [phrase, members] of groups) {
    const ids = [...new Set(members)].sort();
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let step = 1; step <= Math.min(3, ids.length - 1); step++) {
        const [source, target] = [ids[i], ids[(i + step) % ids.length]].sort();
        const id = `${source}->${target}:title`;
        const evidence = `Shared title phrase: “${phrase}”.`;
        const existing = edges.get(id);
        if (existing) {
          if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
        } else edges.set(id, { id, source, target, kind: 'title', weight: 0.7, evidence: [evidence] });
      }
    }
  }
  return [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
}
