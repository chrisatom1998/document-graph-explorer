import { djReviewAllows, resolvedNonSourceLabels } from './soundReviewPolicy';
import type { DocNode } from '../model/types';
import { DJ_CATALOG } from './djTags';
import { INSTRUMENT_LABELS } from './instrumentLabels';
import { keyName } from './musicTypes';
import { confirmedInstrumentList, reliableInstruments, sourceReviewAllows } from './instrumentEvidence';

import type { SampleQuery } from './sampleQuery';
export { EMPTY_SAMPLE_QUERY, parseSampleQuery, type SampleQuery } from './sampleQuery';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]/g, ' ').replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, ' ').trim();
}
function canonical(s: string): string {
  const v = normalize(s);
  return normalize(DJ_CATALOG.find(c => [c.label, ...c.aliases].some(a => normalize(a) === v))?.label ?? v);
}
type Evidence = { label: string; source: 'confirmed' | 'estimated' | 'suggested' };
export function sampleLabels(node: DocNode): Evidence[] {
  const a = node.audio;
  if (!a) return [];
  const confirmedInstruments = confirmedInstrumentList(a);
  const tags: Evidence[] = resolvedNonSourceLabels(a, true).map(({label,source})=>({label,source}));
  if (a.confirmedDjTags === undefined && confirmedInstruments === undefined) tags.push(...(a.soundProfile?.djTags ?? []).filter(t=>t.group==='source'&&sourceReviewAllows(a,t.label)).map(t=>({label:t.label,source:'estimated' as const})));
  // Confirmed DJ labels supersede inconsistent automatic instrument names too.
  if (confirmedInstruments !== undefined) tags.push(...confirmedInstruments.map(label => ({ label, source: 'confirmed' as const })));
  else if (a.confirmedDjTags === undefined) tags.push(...reliableInstruments(a).map(t => ({ label: t.label, source: 'estimated' as const })));
  if (a.confirmedDjTags === undefined && confirmedInstruments === undefined && a.copilotProperties) {
    const proposed = a.copilotProperties.tags;
    tags.push(...proposed.source.filter(label=>sourceReviewAllows(a,label))
      .map(label => ({ label, source: 'suggested' as const })));
  }
  return tags;
}
export interface SampleMatch { node: DocNode; reasons: string[]; score: number }
export function searchSamples(nodes: DocNode[], query: SampleQuery, referenceId?: string): SampleMatch[] {
  if (query.clarification) return [];
  const reference = nodes.find(n => n.id === referenceId && n.fileType === 'audio');
  if (query.similar && !reference) return [];
  const refLabels = reference ? sampleLabels(reference) : [];
  const found: SampleMatch[] = [];
  for (const node of nodes) {
    if (node.kind !== 'document' || node.fileType !== 'audio' || (query.similar && node.id === referenceId)) continue;
    const a = node.audio;
    const labels = sampleLabels(node);
    const reasons: string[] = [];
    let score = 0;
    if (query.confirmedOnly && !labels.some(t => t.source === 'confirmed')) continue;
    const termEvidence = (term: string): string | undefined => {
      const wanted = canonical(term);
      const label = labels.find(t => canonical(t.label) === wanted && (!query.confirmedOnly || t.source === 'confirmed'));
      if (label) return `${label.source === 'confirmed' ? 'Confirmed by you' : label.source === 'suggested' ? 'AI-suggested property' : 'Estimated from audio'}: ${label.label}`;
      const isCategory = DJ_CATALOG.some(c => canonical(c.label) === wanted);
      const isSource = INSTRUMENT_LABELS.some(label=>canonical(label)===wanted)||DJ_CATALOG.some(c=>c.group==='source'&&canonical(c.label)===wanted);
      const latest=a?.soundReviews?.filter(r=>r.dimension==='source'&&canonical(r.labelId)===wanted).at(-1);
      if(isSource && a && (confirmedInstrumentList(a)!==undefined || (latest&&latest.decision!=='confirmed')))return undefined;
      if (a && (!djReviewAllows(a,'production',wanted)||!djReviewAllows(a,'character',wanted))) return undefined;
      if (!query.confirmedOnly && !(isCategory && a?.confirmedDjTags !== undefined) && normalize(node.title).includes(normalize(term))) return `Filename hint: ${term}`;
      return undefined;
    };
    if (query.exclude.some(term => termEvidence(term))) continue;
    const matches = query.terms.map(termEvidence);
    if (matches.some(m => !m)) continue;
    reasons.push(...matches as string[]);
    score += matches.filter(m => m?.startsWith('Confirmed')).length * 3 + matches.length;
    if (query.minBpm !== null || query.maxBpm !== null) {
      if (!a?.tempo || a.stage === 'preview' || a.tempo.confidence < 0.5 || a.tempo.bpm < (query.minBpm ?? 0) || a.tempo.bpm > (query.maxBpm ?? 300)) continue;
      reasons.push(`Measured tempo: ${a.tempo.bpm.toFixed(1)} BPM`);
    }
    if (query.maxSeconds !== null) {
      if (!a || a.durationSeconds > query.maxSeconds) continue;
      reasons.push(`Duration: ${a.durationSeconds.toFixed(1)} seconds`);
    }
    if (query.key !== null) {
      const [pitch, mode] = normalize(query.key).split(' ');
      const semitones: Record<string, number> = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, fb: 4, 'e#': 5, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11, cb: 11, 'b#': 0 };
      if (!a?.key || a.stage === 'preview' || a.key.strength < 0.6 || a.key.tonic !== semitones[pitch] || a.key.mode !== mode) continue;
      reasons.push(`Estimated key: ${keyName(a.key)}`);
    }
    if (query.similar && reference) {
      const shared = labels.filter(t => refLabels.some(r => canonical(r.label) === canonical(t.label)) && (!query.confirmedOnly || t.source === 'confirmed'));
      let similarity = shared.length * 2;
      if (shared.length) reasons.push(`Shared labels: ${[...new Set(shared.map(t => t.label))].join(', ')} (${shared.every(t => t.source === 'confirmed') && refLabels.every(t => t.source === 'confirmed') ? 'confirmed' : 'includes estimates'})`);
      const rt = reference.audio?.tempo; const nt = a?.tempo;
      if (rt && nt && Math.min(rt.confidence, nt.confidence) >= 0.5 && Math.abs(rt.bpm - nt.bpm) <= 4) {
        similarity += 1; reasons.push(`Measured tempos within 4 BPM (${nt.bpm.toFixed(1)} BPM)`);
      }
      const rk = reference.audio?.key; const nk = a?.key;
      if (rk && nk && Math.min(rk.strength, nk.strength) >= 0.6 && rk.tonic === nk.tonic && rk.mode === nk.mode) {
        similarity += 1; reasons.push(`Same estimated key: ${keyName(nk)}`);
      }
      if (!similarity) continue;
      score += similarity;
    }
    if (!reasons.length) reasons.push(query.confirmedOnly ? 'Has labels confirmed by you' : 'Imported audio');
    found.push({ node, reasons: [...new Set(reasons)], score });
  }
  return found.sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
}
