import { jamendoSuggestions } from './jamendo';
import { canonicalDjLabel, type DjTag } from './djTags';
import { isBroadInstrument } from './instrumentLabels';

export interface SongInstrumentCandidate { label: string; score: number; model: 'AudioSet AST' | 'MTG-Jamendo'; }
/** Multi-label music mixtures: instruments do not compete for a single winning slot. */
export function songInstrumentCandidates(scores: Record<string, number>): SongInstrumentCandidate[] {
  return Object.entries(scores).filter(([,score])=>Number.isFinite(score)&&score>=.05&&score<=1)
    .sort((a,b)=>b[1]-a[1]).slice(0,12).map(([label,score])=>({label,score,model:'AudioSet AST'}));
}
export function songInstrumentTags(scores: Record<string, number>): DjTag[] {
  const aliases: Record<string,string> = {'drum kit':'drums','drum machine':'drums','violin / fiddle':'violin','steel guitar / slide guitar':'steel guitar','steelpan':'steel drum'};
  const tags = new Map<string,DjTag>();
  for(const [raw,score] of Object.entries(scores)) {
    // Broad family evidence stays visible in candidates without inventing a specific instrument.
    if(!Number.isFinite(score)||score<.3||score>1||isBroadInstrument(raw))continue;
    const label=canonicalDjLabel('source',aliases[raw]??raw);
    if(label&&score>(tags.get(label)?.score??0))tags.set(label,{group:'source',label,score,model:'AudioSet AST'});
  }
  return [...tags.values()];
}

export function songMusicEvidence(scores: Record<string,number>){
 const candidates:SongInstrumentCandidate[]=Object.entries(scores).filter(([,s])=>Number.isFinite(s)&&s>=.05&&s<=1).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([label,score])=>({label,score,model:'MTG-Jamendo'}));
 const tags:DjTag[]=jamendoSuggestions(scores).flatMap(c=>{
  const label=canonicalDjLabel('source',({'drum kit':'drums','drum machine':'drums'} as Record<string,string>)[c.label]??c.label);
  return label?[{group:'source',label,score:c.score,model:'MTG-Jamendo'}]:[];
 });
 return {candidates,tags};
}
