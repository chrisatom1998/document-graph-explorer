import type { DocNode, Edge } from '../model/types';

export function namedRelationship(nodes: DocNode[], source: string, target: string, label: string): Edge {
  if (source === target) throw new Error('Choose another track.');
  if (![source, target].every((id) => nodes.some((n) => n.id === id && n.fileType === 'audio'))) {
    throw new Error('Choose two audio tracks in this graph.');
  }
  const trimmed = label.trim().slice(0, 180);
  if (!trimmed) throw new Error('Name the relationship.');
  const [a, b] = [source, target].sort();
  return { id: `${a}->${b}:user`, source: a, target: b, kind: 'reference', weight: 1, authored: true, evidence: [`Your relationship: ${trimmed}`] };
}
