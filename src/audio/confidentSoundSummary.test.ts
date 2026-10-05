import {expect,it} from 'vitest';
import {confidentSoundSummary,LIKELY_SOUND_CUTOFF,TRACK_SOUND_FLOOR} from './confidentSoundSummary';
import {createRecognition,recordEvidence} from './recognition';
import type {MusicAnalysis} from './musicTypes';
const audio=():MusicAnalysis=>({version:2,durationSeconds:8,analyzedSeconds:8,instruments:[{label:'piano',score:.99,status:'likely'}],notes:[]});
const head=(score:number):MusicAnalysis=>({...audio(),instruments:[],soundProfile:{version:1,character:[],roles:[],models:[],disagreement:false,djTags:[{group:'production',label:'kick',score,model:'Trained head'}]}});
it.each([.39,.399999,NaN,Infinity,-1,1.01])('excludes invalid or below-floor scores %s',score=>{expect(confidentSoundSummary(head(score))).toEqual([])});
it('uses 0.40 as the track floor and 0.50 as the likely cutoff',()=>{expect([TRACK_SOUND_FLOOR,LIKELY_SOUND_CUTOFF]).toEqual([.4,.5])});
it.each([[.39,undefined],[.4,'possible'],[.49,'possible'],[.5,'likely'],[.9,'likely']] as const)('tiers a track score of %s as %s',(score,tier)=>{expect(confidentSoundSummary(head(score))[0]?.tier).toBe(tier)});
it.each([.4,.49])('keeps the 0.50 floor on one-shots (≤2.25 s): %s hidden',score=>{expect(confidentSoundSummary({...head(score),durationSeconds:1.5,analyzedSeconds:1.5})).toEqual([])});
it('shows a one-shot at 0.50 as likely',()=>{expect(confidentSoundSummary({...head(.5),durationSeconds:1.5,analyzedSeconds:1.5})[0].tier).toBe('likely')});
it('tiers by the best tested score, not an untested model score',()=>{
 const a=head(.45);a.soundProfile!.djTags!.push({group:'production',label:'kick',score:.9,model:'Music CLAP'});expect(confidentSoundSummary(a)[0].tier).toBe('possible');
});
it.each([.5,.500001,1])('includes finite scores at or above the inclusive floor %s',score=>{expect(confidentSoundSummary(head(score))[0]).toMatchObject({label:'kick',origin:'model estimate',scores:[{model:'Trained head score',score}]})});
it('hides labels that only untested models support',()=>{
 const a=audio();a.soundProfile={version:1,character:[],roles:[],models:[],disagreement:false,djTags:[{group:'production',label:'riser',score:.9,model:'Music CLAP'},{group:'character',label:'dark',score:.9,model:'Music CLAP'}]};
 a.recognition=createRecognition(8,'full');recordEvidence(a.recognition,'ast',{start:0,end:8},[{dimension:'source',labelId:'piano',score:.9}]);
 expect(confidentSoundSummary(a)).toEqual([]);
});
it('keeps untested model scores alongside a tested score for the same label',()=>{
 const a=audio();a.instruments=[];a.soundProfile={version:1,character:[],roles:[],models:[],disagreement:false,djTags:[{group:'production',label:'kick',score:.8,model:'Trained head'},{group:'production',label:'kick',score:.6,model:'Music CLAP'}]};
 expect(confidentSoundSummary(a)[0].scores).toEqual([{model:'Trained head score',score:.8},{model:'CLAP similarity',score:.6}]);
});
it('does not promote untested window scores or AI drafts to labels',()=>{
 const a=audio();a.instruments=[];a.recognition=createRecognition(8,'full');recordEvidence(a.recognition,'clap',{start:0,end:8},[{dimension:'effect',labelId:'riser',score:.5},{dimension:'character',labelId:'bright',score:.49}]);a.copilotProperties={model:'draft',tags:{source:['guitar'],production:[],character:[]}};
 expect(confidentSoundSummary(a)).toEqual([]);
});
it('preserves human confirmations and latest rejection/unsure precedence without mutation',()=>{
 const a=audio();a.confirmedInstruments=['piano','guitar'];a.confirmedDjTags={source:['piano'],production:['riser'],character:['distorted','bright']};a.soundReviews=[{dimension:'source',labelId:'piano',decision:'rejected',scope:'track',at:'now',evidenceRunId:'old'},{dimension:'character',labelId:'distorted',decision:'uncertain',scope:'track',at:'now',evidenceRunId:'old'},{dimension:'effect',labelId:'riser',decision:'rejected',scope:'track',at:'now',evidenceRunId:'old'}];const before=JSON.stringify(a);
 expect(confidentSoundSummary(a)).toEqual([{dimension:'source',label:'guitar',origin:'confirmed by you'},{dimension:'character',label:'bright',origin:'confirmed by you'}]);expect(JSON.stringify(a)).toBe(before);
});
it('keeps standalone saved confirmations without a profile and respects reconfirmation',()=>{
 const a=audio();a.instruments=[];a.soundReviews=[{dimension:'effect',labelId:'riser',decision:'uncertain',scope:'track',at:'now',evidenceRunId:'old'},{dimension:'effect',labelId:'riser',decision:'confirmed',scope:'track',at:'now',evidenceRunId:'old'},{dimension:'vocal',labelId:'singing',decision:'confirmed',scope:'track',at:'now',evidenceRunId:'old'}];expect(confidentSoundSummary(a).map(x=>x.label)).toEqual(['riser','singing']);
});
it('does not mutate recognition evidence when hiding untested window scores',()=>{
 const a=audio();a.instruments=[];a.recognition=createRecognition(8,'full');recordEvidence(a.recognition,'ast',{start:0,end:4},[{dimension:'source',labelId:'piano',score:.5}]);recordEvidence(a.recognition,'ast',{start:4,end:8},[{dimension:'source',labelId:'piano',score:.7}]);recordEvidence(a.recognition,'clap',{start:0,end:8},[{dimension:'source',labelId:'piano',score:.51}]);const before=JSON.stringify(a);
 expect(confidentSoundSummary(a)).toEqual([]);expect(JSON.stringify(a)).toBe(before);expect(a.recognition.observations.every(o=>o.status==='possible')).toBe(true);
});
it.each(['rejected','uncertain'] as const)('suppresses %s native and profile scores despite passing the floor',decision=>{
 const a=audio();a.soundReviews=[{dimension:'source',labelId:'piano',decision,scope:'track',at:'now',evidenceRunId:'old'},{dimension:'effect',labelId:'riser',decision,scope:'track',at:'now',evidenceRunId:'old'},{dimension:'character',labelId:'distorted',decision,scope:'track',at:'now',evidenceRunId:'old'}];a.soundProfile={version:1,character:['distorted'],roles:[],models:[],disagreement:false,djTags:[{group:'production',label:'riser',score:1},{group:'character',label:'distorted',score:1}]};expect(confidentSoundSummary(a)).toEqual([]);
});
it('does not invent scores for profile strings, AI drafts or unsupported labels',()=>{
 const a=audio();a.instruments=[{label:'invented instrument',score:1}];a.soundProfile={version:1,source:{label:'guitar',basis:'Music CLAP',corroborated:true},character:['bright'],roles:[],models:[],disagreement:false};a.copilotProperties={model:'draft',tags:{source:['piano'],production:['riser'],character:['bright']}};expect(confidentSoundSummary(a)).toEqual([]);
});
it.each([.399999,.4])('applies inclusive boundaries to character and effect tag scores %s',score=>{
 const a=audio();a.instruments=[];a.soundProfile={version:1,character:[],roles:[],models:[],disagreement:false,djTags:[{group:'production',label:'riser',score,model:'Trained head'},{group:'character',label:'bright',score,model:'Trained head'}]};expect(confidentSoundSummary(a).length).toBe(score>=.4?2:0);
});
it('marks labels backed only by maybe-level trained heads, and lets a full head win',()=>{
 const a=audio();a.instruments=[];a.soundProfile={version:1,character:[],roles:[],models:[],disagreement:false,djTags:[{group:'production',label:'snare',score:.9,model:'Trained head (maybe)'},{group:'production',label:'kick',score:.8,model:'Trained head'}]};
 expect(confidentSoundSummary(a).map(s=>[s.label,s.maybe===true])).toEqual([['snare',true],['kick',false]]);
});
it('can display every catalog label once a trained head reports it',async()=>{
 const {default:catalog}=await import('./djCatalog.json');
 const missing=catalog.categories.filter(c=>{
  const a=audio();a.instruments=[];a.soundProfile={version:1,character:[],roles:[],models:[],disagreement:false,djTags:[{group:c.group as 'source'|'production'|'character',label:c.label,score:.9,model:'Trained head'}]};
  return !confidentSoundSummary(a).some(s=>s.label===c.label);
 }).map(c=>c.label);
 expect(missing).toEqual([]);
});
it('shows full-mix-tested Jamendo synthesizer and drums on recordings of at least ten seconds only',async()=>{
 const {FULL_MIX_JAMENDO,FULL_MIX_JAMENDO_SCORE}=await import('./confidentSoundSummary');
 const synth=FULL_MIX_JAMENDO.synthesizer.threshold,drums=FULL_MIX_JAMENDO['drum kit'].threshold;
 const song=(duration:number)=>{const a:MusicAnalysis={version:2,durationSeconds:duration,analyzedSeconds:duration,instruments:[],notes:[]};a.recognition=createRecognition(duration,'full');
  recordEvidence(a.recognition,'jamendo',{start:0,end:Math.min(10,duration)},[{dimension:'source',labelId:'synthesizer',score:synth},{dimension:'source',labelId:'drum kit',score:drums},{dimension:'source',labelId:'piano',score:.95}]);return a;};
 expect(confidentSoundSummary(song(15)).map(s=>[s.label,s.scores?.find(x=>x.model===FULL_MIX_JAMENDO_SCORE)?.score])).toEqual([['synthesizer',synth],['drums',drums]]);
 // Shorter loops were never measured: Jamendo stays an untested model score there.
 expect(confidentSoundSummary(song(8))).toEqual([]);
});
it('keeps full-mix Jamendo scores below their measured threshold hidden, and honours rejections',async()=>{
 const {FULL_MIX_JAMENDO}=await import('./confidentSoundSummary');
 const a:MusicAnalysis={version:2,durationSeconds:30,analyzedSeconds:30,instruments:[],notes:[]};a.recognition=createRecognition(30,'full');
 recordEvidence(a.recognition,'jamendo',{start:0,end:10},[{dimension:'source',labelId:'synthesizer',score:FULL_MIX_JAMENDO.synthesizer.threshold-.01}]);
 recordEvidence(a.recognition,'jamendo',{start:10,end:20},[{dimension:'source',labelId:'drum kit',score:.99}]);
 a.soundReviews=[{dimension:'source',labelId:'drums',decision:'rejected',scope:'track',at:'now',evidenceRunId:'old'}];
 expect(confidentSoundSummary(a)).toEqual([]);
});
