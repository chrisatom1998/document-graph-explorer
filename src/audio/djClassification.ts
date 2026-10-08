import { DJ_LABELS, DJ_TYPE_SOURCE, applyReviewedDecisions, deriveTestedSources, outranksDjTag, selectDjTags, type DjTag } from './djTags';
import type { DescriptionScore } from './profileDescriptions';
import type { InstrumentEstimate } from './musicTypes';
import type { SoundProfile } from './soundProfile';
import { appendNativeWindow, type NativeWindowEvidence } from './nativeWindowEvidence';

export function applyDjClassification(profile: SoundProfile, ast: InstrumentEstimate[], scores: DescriptionScore[]): SoundProfile {
  let tags = selectDjTags(scores);
  const breath = ast.find(i=>i.label==='breath');
  if (breath?.status==='likely' && !tags.some(t=>t.label==='vocal breath')) tags.push({group:'production',label:'vocal breath',score:breath.score,model:'AudioSet AST'});
  const strongInstrument = ast.some(i=>i.status==='likely' && !['voice','breath'].includes(i.label));
  const breathTag = tags.find(t=>t.label==='vocal breath');
  if (breathTag && !strongInstrument && (!profile.source?.corroborated || profile.source.label==='breath')) {
    profile.source = {label:'breath',basis:breath?.status==='likely'?'AudioSet AST':'Music CLAP',corroborated:!!breath && breath.score>=.55 && scores.some(s=>s.label==='vocal breath' && s.score>=.35)};
    delete profile.voice;
  }
  if (profile.voice?.style==='vocal chops') tags = tags.filter(t=>t.group!=='production' || DJ_TYPE_SOURCE[t.label] !== 'synthesizer');
  if (profile.voice?.style==='vocal chops' && !tags.some(t=>t.label==='vocal chops')) {
    const score=Math.max(0,...scores.filter(s=>s.label==='vocal chops').map(s=>s.score));
    if(score) tags.push({group:'production',label:'vocal chops',score,model:'Music CLAP'});
  }
  // A descriptive synth match must not turn a clearly acoustic source into a synth.
  tags=tags.filter(t=>t.group!=='production' || !DJ_TYPE_SOURCE[t.label] || t.label === 'vocal pad' || !profile.source || DJ_TYPE_SOURCE[t.label]===profile.source.label || ['voice','breath'].includes(DJ_TYPE_SOURCE[t.label]) || (DJ_TYPE_SOURCE[t.label]==='drums' && ['drum kit','drum machine','percussion'].includes(profile.source.label)));
  // CLAP resemblance must not override a strongly supported physical source.
  if (strongInstrument && profile.source) tags = tags.filter(t => t.group !== 'source' || t.label === profile.source!.label || ['voice','breath'].includes(t.label));
  const primary=tags.find(t=>t.group==='production');
  if (!profile.source && primary && DJ_TYPE_SOURCE[primary.label]) profile.source={label:DJ_TYPE_SOURCE[primary.label],basis:'Music CLAP',corroborated:false};
  if (profile.source) {
    const source=['drum kit','drum machine','percussion'].includes(profile.source.label)?'drums':profile.source.label;
    if ((DJ_LABELS.source as readonly string[]).includes(source)) tags.push({group:'source',label:source,model:profile.source.basis,score:Math.max(0,...profile.models.flatMap(m=>m.candidates.filter(c=>c.label===profile.source?.label).map(c=>c.score)),...tags.filter(t=>t.group==='production' && DJ_TYPE_SOURCE[t.label]===source).map(t=>t.score))});
  }
  for (const label of profile.character) if ((DJ_LABELS.character as readonly string[]).includes(label)) tags.push({group:'character',label,model:'Music CLAP',score:Math.max(0,...scores.filter(s=>s.label===label).map(s=>s.score))});
  // Keep the best-checked tag per label: a profile source labelled with an untested model must not hide a tested head.
  const byLabel=new Map<string,DjTag>();
  for (const t of tags) { const key=`${t.group}:${t.label}`; if (outranksDjTag(t,byLabel.get(key))) byLabel.set(key,t); }
  deriveTestedSources(byLabel);
  profile.djTags=applyReviewedDecisions([...byLabel.values()],scores);
  const learned = profile.djTags.filter(t=>t.model==='Reviewed examples');
  if (scores.some(s=>s.group==='dj-learned' && s.learnedGroup==='source' && s.decision==='exclude' && s.score>=.94 && s.label===profile.source?.label)) delete profile.source;
  const source = learned.find(t=>t.group==='source');
  if (source) profile.source={label:source.label,basis:'Reviewed examples',corroborated:false};
  if (scores.some(s=>s.group==='dj-learned' && s.decision==='exclude' && s.score>=.94 && s.label==='vocal chops')) delete profile.voice;
  if (learned.some(t=>t.label==='vocal chops')) profile.voice={basis:'Reviewed examples',corroborated:false,style:'vocal chops'};
  if (learned.length) profile.models.push({model:'Reviewed examples',complete:true,candidates:learned.map(t=>({label:t.label,score:t.score}))});
  return profile;
}
export function mergeDjTags(profile: SoundProfile, passages: DjTag[], scores: DescriptionScore[] = []): void {
  const all=new Map((profile.djTags??[]).map(t=>[`${t.group}:${t.label}`,t]));
  for(const tag of passages) {
    if (tag.group === 'source' && tag.model === 'Music CLAP' && profile.source?.basis === 'AudioSet AST' && tag.label !== profile.source.label && !['voice','breath'].includes(tag.label)) continue;
    if (tag.model !== 'Reviewed examples' && tag.group==='production' && DJ_TYPE_SOURCE[tag.label]==='synthesizer' && profile.source?.basis==='AudioSet AST' && profile.source.label!=='synthesizer') continue;
    const key=`${tag.group}:${tag.label}`; const existing=all.get(key);
    const retained=existing && !outranksDjTag(tag,existing) ? {...existing,segments:tag.segments}:tag;
    if(existing&&existing.model===tag.model){
      // A profile aggregate and a passage can share a detector without sharing its score provenance. Merge only
      // that detector's actual scored windows; an unlocalized aggregate makes the combined evidence incomplete.
      const sources=[existing.windowEvidence,tag.windowEvidence];
      if(sources.some(Boolean)){
        const windowEvidence:NativeWindowEvidence={windows:[],complete:sources.every(e=>e?.complete===true)};
        const byInterval=new Map<string,{start:number;end:number;score:number}>();
        for(const source of sources)for(const w of source?.windows??[]){const id=`${w.start}:${w.end}`,old=byInterval.get(id);if(!old||w.score>old.score)byInterval.set(id,w);}
        for(const w of byInterval.values())appendNativeWindow(windowEvidence,w);
        all.set(key,{...retained,windowEvidence});
      }else all.set(key,retained);
    }else all.set(key,retained);
    if (tag.model !== 'Reviewed examples' && tag.group==='production' && DJ_TYPE_SOURCE[tag.label]) {
      const label=DJ_TYPE_SOURCE[tag.label];
      if (!all.has(`source:${label}`)) all.set(`source:${label}`,{...tag,group:'source',label});
    }
  }
  deriveTestedSources(all);
  profile.djTags=applyReviewedDecisions([...all.values()],scores);
  const rejectedSources=new Set(scores.filter(s=>s.group==='dj-learned'&&s.learnedGroup==='source'&&s.decision==='exclude'&&s.score>=.94).map(s=>s.label));
  profile.djTags=profile.djTags.filter(t=>t.group!=='production'||!rejectedSources.has(DJ_TYPE_SOURCE[t.label]));
}
