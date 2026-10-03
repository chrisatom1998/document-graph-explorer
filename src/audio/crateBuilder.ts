import type { DocNode } from '../model/types';
import { parseSampleQuery, searchSamples, sampleLabels, type SampleQuery } from './sampleSearch';

export interface CratePlan { groups: { role: string; count: number; query: SampleQuery }[]; clarification: string | null }
export interface CrateEntry { node: DocNode; role: string; reasons: string[]; confidence: number }
export function parseCratePlan(raw: unknown): CratePlan {
  if (!raw || typeof raw !== 'object') throw Error('Invalid crate plan.');
  const value = raw as CratePlan;
  if (!Array.isArray(value.groups) || value.groups.length > 5 || (value.clarification !== null && (typeof value.clarification !== 'string' || value.clarification.length > 500))) throw Error('Invalid crate groups.');
  const groups = value.groups.map(group => {
    if (!group || typeof group.role !== 'string' || !group.role.trim() || group.role.length > 80 || !Number.isInteger(group.count) || group.count < 1 || group.count > 8) throw Error('Invalid crate role.');
    const query = parseSampleQuery(group.query);
    if (query.clarification) throw Error(query.clarification);
    return { role: group.role, count: group.count, query };
  });
  if (!groups.length && !value.clarification) throw Error('Describe at least one sound for the crate.');
  return { groups, clarification: value.clarification };
}
export function sampleReliability(node: DocNode): number {
  const labels = sampleLabels(node);
  return (labels.some(l => l.source === 'confirmed') ? 10 : 0)
    + (node.audio?.stage !== 'preview' && node.audio?.instrumentScan?.complete ? 2 : 0)
    + (node.audio?.tempo?.confidence ?? 0) + (node.audio?.key?.strength ?? 0);
}
/** A plan is interpreted remotely; all candidates and constraints are checked locally. */
export function buildCrate(nodes: DocNode[], plan: CratePlan, referenceId?: string, excludedIds: string[] = []) {
  const used = new Set(excludedIds);
  const entries: CrateEntry[] = [];
  const missing: string[] = [];
  if (plan.clarification) return { entries, missing: [plan.clarification] };
  for (const group of plan.groups) {
    const candidates = searchSamples(nodes, group.query, referenceId)
      .filter(m => !used.has(m.node.id)).sort((a, b) => sampleReliability(b.node) - sampleReliability(a.node) || b.score - a.score || a.node.title.localeCompare(b.node.title));
    const picked = candidates.slice(0, group.count);
    for (const match of picked) { used.add(match.node.id); entries.push({ ...match, role: group.role, confidence: sampleReliability(match.node) }); }
    if (picked.length < group.count) missing.push(`${group.role}: found ${picked.length} of ${group.count}. No unsupported matches were added.`);
  }
  return { entries, missing };
}
