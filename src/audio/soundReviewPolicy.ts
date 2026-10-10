import { confirmedInstrumentList } from './instrumentEvidence';
import { CHARACTER_LABELS } from './soundProfile';
import { canonicalDjLabel, DJ_CATALOG, mergedDjLabel, outranksDjTag, type DjGroup, type DjTag } from './djTags';
import type { MusicAnalysis } from './musicTypes';
import type { Dimension } from './recognition';
import { canonicalReviewLabel, latestSoundReview, sharedSoundReviewIdentity } from './soundReviewIdentity';
export { latestSoundReview } from './soundReviewIdentity';
import { isRuleDescribedLabel } from './timbreDescriptions';

export const EFFECT_EVENT_LABELS = DJ_CATALOG.filter(c => c.group === 'production' && c.source === 'sound effect').map(c => c.label);
export function djReviewDimension(group: DjGroup, label: string): Dimension | undefined {
  return group === 'source' ? 'source' : group === 'character' ? 'character'
    : label === 'atmosphere' || EFFECT_EVENT_LABELS.includes(canonicalDjLabel('production', label) ?? label)
      || sharedSoundReviewIdentity('effect', label) ? 'effect' : undefined;
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
  const evidence = new Map<string,DjTag>();
  const add = (rawGroup: DjGroup, raw: string, source: ResolvedDjLabel['source'], score?: number, model?: DjTag['model']) => {
    // Route old cached labels before choosing their consumer policy; turntable is now an effect and vocal harmony is
    // choir. A non-source label merged into a source (vocal breath) keeps its group here; source consumers own it.
    const canonical = canonicalDjLabel(rawGroup, raw) ?? raw;
    const merged = mergedDjLabel(rawGroup, canonical);
    const {group,label} = rawGroup === 'source' || merged.group !== 'source' ? merged : {group:rawGroup,label:canonical};
    if (group === 'source') return;
    const dimension = djReviewDimension(group, label);
    const review = dimension && latestSoundReview(analysis.soundReviews, dimension, label);
    if (review && review.decision !== 'confirmed') return;
    // Shared source/effect aliases keep their saved dimension, except explicit display-name merges.
    if (review && dimension && review.dimension !== dimension && sharedSoundReviewIdentity(dimension, label)) {
      const reviewGroup = review.dimension === 'source' ? 'source' : review.dimension === 'effect' ? 'production' : review.dimension === 'character' ? 'character' : undefined;
      const merged = reviewGroup && mergedDjLabel(reviewGroup, canonicalDjLabel(reviewGroup, review.labelId) ?? review.labelId);
      if (!merged || merged.group !== group || merged.label !== label) return;
    }
    const origin = review ? 'confirmed' : source;
    // warm, airy, metallic… are described by DSP rules (timbreDescriptions.ts); only your confirmation keeps one as a label.
    if (group === 'character' && origin !== 'confirmed' && isRuleDescribedLabel(label)) return;
    const key = `${group}:${label}`;
    const previous = labels.get(key);
    const tag = score !== undefined ? {group,label,score,model} : undefined;
    if (!previous || priority[origin] > priority[previous.source]
      || origin === 'estimated' && previous.source === 'estimated' && tag && outranksDjTag(tag, evidence.get(key))) {
      labels.set(key,{group,label,source:origin,...(origin === 'estimated' && score !== undefined ? {score} : {})});
      if (origin === 'estimated' && tag) evidence.set(key,tag);
    }
  };
  if (analysis.confirmedDjTags !== undefined) {
    for (const group of ['source','production','character'] as const) for (const label of analysis.confirmedDjTags[group]) add(group,label,'confirmed');
  } else {
    for (const tag of analysis.soundProfile?.djTags ?? []) add(tag.group,tag.label,'estimated',tag.score,tag.model);
    for (const label of analysis.soundProfile?.character ?? []) add('character',label,'estimated');
    if (includeSuggestions) for (const group of ['source','production','character'] as const) for (const label of analysis.copilotProperties?.tags[group] ?? []) add(group,label,'suggested');
  }
  for (const review of analysis.soundReviews ?? []) {
    if (review.decision !== 'confirmed') continue;
    const group = review.dimension === 'character' ? 'character' : review.dimension === 'effect' ? 'production' : review.dimension === 'source' ? 'source' : undefined;
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
  for(const rawGroup of ['source','production','character'] as const) for(const raw of analysis.copilotProperties?.tags[rawGroup]??[]) {
    const canonical=canonicalDjLabel(rawGroup,raw)??raw;
    const merged=mergedDjLabel(rawGroup,canonical);
    const {group,label}=rawGroup==='source'||merged.group!=='source'?merged:{group:rawGroup,label:canonical};
    const dimension=djReviewDimension(group,label);
    const review=dimension&&latestSoundReview(analysis.soundReviews,dimension,label);
    const projected=group==='source'?undefined:nonSource.find(t=>t.group===group&&t.label===label);
    if(review) historical.push({group,label:raw,reason:`${review.decision} by you`});
    else if(analysis.confirmedDjTags!==undefined||(group==='source'&&confirmedInstrumentList(analysis)!==undefined)) historical.push({group,label:raw,reason:'superseded by your saved corrections'});
    else if(group!=='source'&&projected?.source!=='suggested') historical.push({group,label:raw,reason:projected?.source==='confirmed'?'confirmed by you':'superseded by current audio evidence'});
    else if(!current.some(t=>t.group===group&&t.label===label)) current.push({group,label});
  }
  return {current,historical};
}
