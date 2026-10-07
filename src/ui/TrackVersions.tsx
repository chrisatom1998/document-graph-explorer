import { useMemo } from 'react';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { versionRelation, type VersionRelation } from '../audio/versionLinks';
import { focusNode } from './focusNode';
import './TrackVersions.css';

export interface VersionMember { node: DocNode; relation: VersionRelation; evidence: string; via?: DocNode }
/** Copies of this recording (chained through copies of copies), plus other versions linked to any of them and
 * those versions' own copies. One remix link at most: a second step would join songs through one wrong link. */
export function versionGroup(id: string, nodes: DocNode[], edges: Edge[]): VersionMember[] {
  const links = new Map<string, { other: string; relation: VersionRelation; evidence: string }[]>();
  for (const edge of edges) {
    const relation = versionRelation(edge);
    if (!relation) continue;
    for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) links.set(a, [...(links.get(a) ?? []), { other: b, relation, evidence: edge.evidence[0] ?? '' }]);
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  const found = new Map<string, VersionMember>();
  const seen = new Set([id]);
  /** Copies reachable from `start` through copy links only. */
  const copiesOf = (start: string, relation: VersionRelation, via?: DocNode) => {
    const queue = [start], members: string[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      for (const link of links.get(current) ?? []) {
        if (link.relation !== 'duplicate' || seen.has(link.other) || !byId.has(link.other)) continue;
        seen.add(link.other); queue.push(link.other); members.push(link.other);
        found.set(link.other, { node: byId.get(link.other)!, relation, evidence: link.evidence, via: current === id ? undefined : via ?? byId.get(current) });
      }
    }
    return members;
  };
  const recording = [id, ...copiesOf(id, 'duplicate')];
  for (const member of recording) for (const link of links.get(member) ?? []) {
    if (link.relation !== 'remix' || seen.has(link.other) || !byId.has(link.other)) continue;
    seen.add(link.other);
    const via = member === id ? undefined : byId.get(member);
    found.set(link.other, { node: byId.get(link.other)!, relation: 'remix', evidence: link.evidence, via });
    copiesOf(link.other, 'remix', byId.get(link.other));
  }
  return [...found.values()].sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'duplicate' ? -1 : 1) || a.node.title.localeCompare(b.node.title));
}

/** The track card's "Versions" group: copies of this recording, then other versions of the song. */
export default function TrackVersions({ node }: { node: DocNode }) {
  const nodes = useGraphStore(s => s.nodes);
  const edges = useGraphStore(s => s.edges);
  const members = useMemo(() => versionGroup(node.id, nodes, edges), [node.id, nodes, edges]);
  if (!members.length) return null;
  const copies = members.filter(m => m.relation === 'duplicate'), others = members.filter(m => m.relation === 'remix');
  const row = (m: VersionMember) => <li key={m.node.id}>
    <button type="button" onClick={() => focusNode(m.node.id)} title={m.node.title}>{m.node.title}</button>
    <small>{m.via ? `Through ${m.via.title}.` : m.evidence}</small>
  </li>;
  return <section className="track-versions" aria-label="Versions">
    <h4>Versions ({members.length + 1})</h4>
    {copies.length > 0 && <><p className="track-versions__kind">Same recording ({copies.length})</p><ul>{copies.map(row)}</ul></>}
    {others.length > 0 && <><p className="track-versions__kind">Other versions of this song ({others.length})</p><ul>{others.map(row)}</ul></>}
  </section>;
}
