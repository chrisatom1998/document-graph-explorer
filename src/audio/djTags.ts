import type { DescriptionScore } from './profileDescriptions';

import catalog from './djCatalog.json';

export type DjGroup = 'source' | 'production' | 'character';
export const DJ_CATALOG = catalog.categories;
export const DJ_LABELS: Record<DjGroup, readonly string[]> = {
  source: DJ_CATALOG.filter(c => c.group === 'source').map(c => c.label),
  production: DJ_CATALOG.filter(c => c.group === 'production').map(c => c.label),
  character: DJ_CATALOG.filter(c => c.group === 'character').map(c => c.label),
};
export type ConfirmedDjTags = Record<DjGroup, string[]>;
export interface DjTag { group: DjGroup; label: string; score: number; model?: 'AudioSet AST' | 'MTG-Jamendo' | 'Music CLAP' | 'Reviewed examples' | 'Trained head' | 'Trained head (maybe)'; segments?: { start: number; end: number }[] }
export const DJ_TYPE_SOURCE: Record<string, string> = Object.fromEntries(
  DJ_CATALOG.filter(c => c.group === 'production' && c.source).map(c => [c.label, c.source!]),
);
/** On-screen name for a label. The stored label stays the same so trained heads and saved corrections keep working. */
const DISPLAY_NAMES: Record<string, string> = { plucked: 'one shot' };
export function soundLabelText(label: string): string { return DISPLAY_NAMES[label] ?? label.replaceAll('_', ' '); }
export function canonicalDjLabel(group: DjGroup, raw: unknown): string | undefined {
  if (typeof raw !== 'string') return;
  const label = raw.trim().toLowerCase();
  // Exact canonical labels take priority over aliases (e.g. synth bass / 808).
  return DJ_CATALOG.find(c => c.group === group && c.label === label)?.label
    ?? DJ_CATALOG.find(c => c.group === group && c.aliases.includes(label))?.label;
}
const allowed = (group: DjGroup, value: unknown): value is string => typeof value === 'string' && (DJ_LABELS[group] as readonly string[]).includes(value);
export function sanitizeConfirmedDjTags(raw: unknown): ConfirmedDjTags | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const input = raw as Record<string, unknown>;
  if (!['source','production','character'].every(g => Array.isArray(input[g]))) return;
  return Object.fromEntries(Object.keys(DJ_LABELS).map(group => [group, [...new Set((input[group] as unknown[]).slice(0, DJ_LABELS[group as DjGroup].length * 2).map(v => canonicalDjLabel(group as DjGroup, v)).filter((v): v is string => !!v))].slice(0, DJ_LABELS[group as DjGroup].length)])) as ConfirmedDjTags;
}
export function sanitizeDjTags(raw: unknown): DjTag[] {
  if (!Array.isArray(raw)) return [];
  const tags = new Map<string,DjTag>();
  for (const v of raw.slice(0,DJ_CATALOG.length * 2)) {
    if (!v || typeof v !== 'object') continue;
    const group = v.group as DjGroup;
    if (!Object.hasOwn(DJ_LABELS, group) || !allowed(group,v.label) || !Number.isFinite(v.score) || v.score < 0 || v.score > 1) continue;
    const tag: DjTag = {group,label:v.label,score:v.score};
    if (['AudioSet AST','MTG-Jamendo','Music CLAP','Reviewed examples','Trained head','Trained head (maybe)'].includes(v.model)) tag.model=v.model;
    if (Array.isArray(v.segments)) tag.segments = v.segments.slice(0,3).filter((s: {start:number;end:number}) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= 86400).map((s: {start:number;end:number})=>({start:s.start,end:s.end}));
    tags.set(`${group}:${tag.label}`,tag);
  }
  return [...tags.values()];
}
/** A winner is not enough: explicitly compare against confusing alternatives. */
export function selectDjTags(scores: DescriptionScore[]): DjTag[] {
  const tags: DjTag[] = [];
  for (const axis of ['dj-type','breath','dj-tone','dj-rhythm'] as const) {
    const ranked = scores.filter(s=>s.group===axis && Number.isFinite(s.score)).sort((a,b)=>b.score-a.score);
    const top = ranked[0]; const group: DjGroup = axis==='dj-tone'||axis==='dj-rhythm' ? 'character':'production';
    if (!top?.label || !allowed(group,top.label)) continue;
    // Breath must also beat its dedicated noise/instrument alternatives.
    if (axis==='dj-type' && top.label==='vocal breath') continue;
    const threshold = top.label==='vocal breath' ? .45 : group==='character' ? .30:.35;
    const margin = axis==='breath' ? .05:.04;
    if (top.score >= threshold && top.score-(ranked[1]?.score ?? 0) >= margin) tags.push({group,label:top.label,score:top.score,model:'Music CLAP'});
  }
  // Each new family competes independently, so a vocal, drum and effect
  // can coexist. Never accept an isolated score without competing prompts.
  const axes = [...new Set(DJ_CATALOG.map(c => c.axis))].filter(axis => !['dj-type','breath','dj-tone','dj-rhythm'].includes(axis));
  for (const axis of axes) {
    const ranked = scores.filter(s => s.group === axis && Number.isFinite(s.score)).sort((a,b) => b.score-a.score);
    const top = ranked[0];
    const category = DJ_CATALOG.find(c => c.axis === axis && c.label === top?.label);
    if (!category || ranked.length < 2 || !top) continue;
    const threshold = category.group === 'character' ? .35 : .40;
    if (top.score >= threshold && top.score - ranked[1].score >= .05) {
      tags.push({group: category.group as DjGroup, label: category.label, score: top.score, model: 'Music CLAP'});
    }
  }
  return applyReviewedDecisions(tags, scores);
}
/** Store bounded examples of accepted tags instead of averaging brief sounds away. */
export class DjTagEvidence {
  private tags = new Map<string,DjTag>();
  add(tags: DjTag[], start: number, end: number) {
    for (const tag of tags) {
      const key=`${tag.group}:${tag.label}`; const existing=this.tags.get(key);
      if (!existing) this.tags.set(key,{...tag,segments:[{start,end}]});
      else {
        existing.score=Math.max(existing.score,tag.score);
        if (existing.segments && existing.segments.length<3 && !existing.segments.some(s=>s.start===start)) existing.segments.push({start,end});
      }
    }
  }
  results() { return [...this.tags.values()].sort((a,b)=>b.score-a.score); }
}

/** Apply only labels known to this app; reviewed examples may add or reject a tag. */
export function applyReviewedDecisions(tags: DjTag[], scores: DescriptionScore[]): DjTag[] {
  const result = new Map(tags.map(t => [`${t.group}:${t.label}`, t]));
  for (const score of scores) {
    if (score.group !== 'dj-learned' || !score.learnedGroup || !score.label || !allowed(score.learnedGroup,score.label)) continue;
    const key = `${score.learnedGroup}:${score.label}`;
    if (score.basis === 'head') {
      // A trained head already cleared its own measured threshold. It adds a tag under its
      // own name and never overrides a user-reviewed example or a stronger existing tag.
      const existing = result.get(key);
      if (score.decision === 'include' && existing?.model !== 'Reviewed examples' && (existing?.score ?? 0) < score.score)
        result.set(key,{group:score.learnedGroup,label:score.label,score:score.score,model:score.maybe?'Trained head (maybe)':'Trained head'});
      continue;
    }
    if (score.decision === 'exclude' && score.score >= .94) result.delete(key);
    if (score.decision === 'include' && score.score >= .88) result.set(key,{group:score.learnedGroup,label:score.label,score:score.score,model:'Reviewed examples'});
  }
  return [...result.values()];
}
