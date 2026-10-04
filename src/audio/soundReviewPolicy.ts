import { confirmedInstrumentList } from './instrumentEvidence';
import { CHARACTER_LABELS } from './soundProfile';
import { canonicalDjLabel, DJ_CATALOG, type DjGroup } from './djTags';
import type { MusicAnalysis } from './musicTypes';
import type { Dimension, SoundReview } from './recognition';

export const EFFECT_EVENT_LABELS = DJ_CATALOG.filter(c => c.group === 'production' && c.source === 'sound effect').map(c => c.label);
const canonicalReviewLabel = (dimension: Dimension, label: string) => dimension === 'character'
  ? canonicalDjLabel('character', label) ?? label
  : dimension === 'effect' ? canonicalDjLabel('production', label) ?? label : label;

/** Append order is authoritative, even when timestamps tie or evidence changes. */
export function latestSoundReview(reviews: readonly SoundReview[] | undefined, dimension: Dimension, label: string): SoundReview | undefined {
  const key = canonicalReviewLabel(dimension, label);
  for (let i = (reviews?.length ?? 0) - 1; i >= 0; i--) {
    const review = reviews![i];
    if (review.dimension === dimension && canonicalReviewLabel(dimension, review.labelId) === key) return review;
  }
  return undefined;
}
export function djReviewDimension(group: DjGroup, label: string): Dimension | undefined {
  return group === 'source' ? 'source' : group === 'character' ? 'character'
    : label === 'atmosphere' || EFFECT_EVENT_LABELS.includes(canonicalDjLabel('production', label) ?? label) ? 'effect' : undefined;
}
export function djReviewAllows(analysis: Pick<MusicAnalysis,'soundReviews'>, group: DjGroup, label: string): boolean {
  const dimension = djReviewDimension(group, label);
  const review = dimension && latestSoundReview(analysis.soundReviews, dimension, label);
  return !review || review.decision === 'confirmed';
}
export interface ResolvedDjLabel {
  group: 'production' | 'character'; label: string;
  source: 'confirmed' | 'estimated' | 'suggested'; score?: number;
}
/** A read-only consumer projection. Never turn unknown/rejected evidence into absent truth. */
export function resolvedNonSourceLabels(analysis: MusicAnalysis, includeSuggestions = false): ResolvedDjLabel[] {
  const labels = new Map<string,ResolvedDjLabel>();
  const priority = { suggested: 0, estimated: 1, confirmed: 2 };
  const add = (group: ResolvedDjLabel['group'], raw: string, source: ResolvedDjLabel['source'], score?: number) => {
    const label = canonicalDjLabel(group, raw) ?? raw;
    const dimension = djReviewDimension(group, label);
    const review = dimension && latestSoundReview(analysis.soundReviews, dimension, label);
    if (review && review.decision !== 'confirmed') return;
    const origin = review ? 'confirmed' : source;
    const key = `${group}:${label}`;
    const previous = labels.get(key);
    if (!previous || priority[origin] > priority[previous.source]) labels.set(key,{group,label,source:origin,...(origin === 'estimated' && score !== undefined ? {score} : {})});
  };
  if (analysis.confirmedDjTags !== undefined) {
    for (const group of ['production','character'] as const) for (const label of analysis.confirmedDjTags[group]) add(group,label,'confirmed');
  } else {
    for (const tag of analysis.soundProfile?.djTags ?? []) if (tag.group !== 'source') add(tag.group,tag.label,'estimated',tag.score);
    for (const label of analysis.soundProfile?.character ?? []) add('character',label,'estimated');
    if (includeSuggestions) for (const group of ['production','character'] as const) for (const label of analysis.copilotProperties?.tags[group] ?? []) add(group,label,'suggested');
  }
  for (const review of analysis.soundReviews ?? []) {
    if (review.decision !== 'confirmed') continue;
    const group = review.dimension === 'character' ? 'character' : review.dimension === 'effect' ? 'production' : undefined;
    if (group) add(group,review.labelId,'confirmed');
  }
  return [...labels.values()];
}

/** Keep source/voice handling independent; raw profiles and historical scores are untouched. */
export function reviewedSoundProfile(analysis: MusicAnalysis) {
  const profile = analysis.soundProfile;
  if (!profile) return undefined;
  return {...profile,
    models: profile.models.map(model=>({...model,candidates:model.candidates.filter(candidate=>
      (CHARACTER_LABELS.includes(candidate.label)||canonicalDjLabel('character',candidate.label))
        ? djReviewAllows(analysis,'character',candidate.label)
        : djReviewAllows(analysis,'production',candidate.label))})),
    roles: profile.roles.filter(label => label !== 'atmosphere' || djReviewAllows(analysis,'production',label)),
    character: profile.character.filter(label => djReviewAllows(analysis,'character',label)),
    djTags: profile.djTags?.filter(tag => tag.group === 'source' || djReviewAllows(analysis,tag.group,tag.label)),
  };
}

const searchWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}#]+/gu,' ').trim();
const categoryAliases = DJ_CATALOG.filter(c=>c.group==='character'||EFFECT_EVENT_LABELS.includes(c.label))
  .flatMap(c=>c.aliases.map(alias=>({alias:searchWords(alias),label:searchWords(c.label)})))
  .filter(c=>c.alias).sort((a,b)=>b.alias.length-a.alias.length);
/** Reuse the catalog's exact aliases without substring matches inside other words. */
export function canonicalSoundCategoryText(text: string): string {
  let result=searchWords(text);
  for(const {alias,label} of categoryAliases) result=result.replace(new RegExp(`(^| )${alias}(?= |$)`,'g'),`$1${label}`);
  return result;
}
/** Semantic category retrieval may not revive a reviewed label from a filename. */
export function semanticCategoryReviewAllows(analysis: Pick<MusicAnalysis,'soundReviews'>, query: string): boolean {
  const text=` ${canonicalSoundCategoryText(query)} `;
  return (analysis.soundReviews??[]).every(review=>{
    if(review.dimension!=='effect'&&review.dimension!=='character')return true;
    const label=canonicalReviewLabel(review.dimension,review.labelId);
    return !text.includes(` ${searchWords(label)} `)||latestSoundReview(analysis.soundReviews,review.dimension,label)?.decision==='confirmed';
  });
}

export function projectedCopilotProperties(analysis: MusicAnalysis) {
  const current: {group:DjGroup;label:string}[]=[];
  const historical: {group:DjGroup;label:string;reason:string}[]=[];
  const nonSource=resolvedNonSourceLabels(analysis,true);
  for(const group of ['source','production','character'] as const) for(const raw of analysis.copilotProperties?.tags[group]??[]) {
    const label=canonicalDjLabel(group,raw)??raw;
    const dimension=djReviewDimension(group,label);
    const review=dimension&&latestSoundReview(analysis.soundReviews,dimension,label);
    const projected=group==='source'?undefined:nonSource.find(t=>t.group===group&&t.label===label);
    if(review) historical.push({group,label:raw,reason:`${review.decision} by you`});
    else if(analysis.confirmedDjTags!==undefined||(group==='source'&&confirmedInstrumentList(analysis)!==undefined)) historical.push({group,label:raw,reason:'superseded by your saved corrections'});
    else if(group!=='source'&&projected?.source!=='suggested') historical.push({group,label:raw,reason:projected?.source==='confirmed'?'confirmed by you':'superseded by current audio evidence'});
    else current.push({group,label});
  }
  return {current,historical};
}
