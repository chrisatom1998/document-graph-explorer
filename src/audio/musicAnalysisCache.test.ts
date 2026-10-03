import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {musicCacheKey,musicCacheFingerprint,readMusicCache,writeMusicCache} from './musicAnalysisCache';
import { createRecognition, finishJob, type Recognition } from './recognition';
import type {MusicAnalysis} from './musicTypes';
const db=vi.hoisted(()=>{
 const values=new Map<string,unknown>();
 const store={get:async(k:string)=>values.get(k),put:async(v:unknown,k:string)=>{values.set(k,v);},getAllKeys:async()=>[...values.keys()],delete:async(k:string)=>{values.delete(k);}};
 return {values,store};
});
vi.mock('../persistence/db',()=>({getDb:async()=>({get:async(_store:string,k:string)=>db.store.get(k),transaction:()=>({store:db.store,done:Promise.resolve()})})}));
beforeEach(()=>db.values.clear());afterEach(()=>vi.unstubAllGlobals());
function completedRecognition(duration=10):Recognition {
 const recognition=createRecognition(duration,'full');
 for(const job of recognition.jobs) {
  job.planned=[{start:0,end:duration}];job.attempted=[...job.planned];job.successful=[...job.planned];finishJob(job,duration);
 }
 recognition.status='complete';recognition.endedAt='2026-10-03T00:00:00Z';
 return recognition;
}
const audio:MusicAnalysis={version:2,durationSeconds:10,analyzedSeconds:10,instruments:[],notes:[],instrumentScan:{complete:true,analyzedSeconds:10,windows:1},confirmedDjTags:{source:['piano'],production:[],character:[]},confirmedInstruments:['piano'],soundReviews:[{labelId:'piano',dimension:'source',decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'test'}],recognition:completedRecognition()};
it('reuses identical bytes but invalidates results after model updates or a mode change',async()=>{
 let learned='a'.repeat(64);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({revision:'r',sha256:{'learned.json':learned,'prompts.json':'b'.repeat(64)}})));
 const blob=new Blob(['audio']);const first=await musicCacheKey(blob,'fast');
 expect(first).toBe(await musicCacheKey(new Blob(['audio']),'fast'));
 expect(first).not.toBe(await musicCacheKey(blob,'full'));
 const other=await musicCacheKey(new Blob(['other audio']),'fast');expect(musicCacheFingerprint(first!)).toBe(musicCacheFingerprint(other!));
 learned='c'.repeat(64);const changed=await musicCacheKey(blob,'fast');expect(changed).not.toBe(first);expect(musicCacheFingerprint(changed!)).not.toBe(musicCacheFingerprint(first!));
});
it('caches only finished automatic results and does not copy user corrections',async()=>{
 await writeMusicCache('music-analysis:v2:test',audio);const found=await readMusicCache('music-analysis:v2:test');
 expect(found?.instrumentScan?.complete).toBe(true);expect(found?.confirmedInstruments).toBeUndefined();expect(found?.confirmedDjTags).toBeUndefined();expect(found?.soundReviews).toBeUndefined();
 await writeMusicCache('music-analysis:v2:preview',{...audio,stage:'preview'});expect(await readMusicCache('music-analysis:v2:preview')).toBeUndefined();
});
it('bounds cached entries without removing unrelated settings',async()=>{
 db.values.set('user-preference',true);
 for(let i=0;i<102;i++)await writeMusicCache('music-analysis:v2:'+i,audio);
 expect([...db.values.keys()].filter(k=>k.startsWith('music-analysis:v2:'))).toHaveLength(100);expect(db.values.get('user-preference')).toBe(true);
});

it('does not reuse pre-ledger or outdated-configuration results',async()=>{
 await writeMusicCache('music-analysis:v2:old',{...audio,recognition:undefined});
 expect(await readMusicCache('music-analysis:v2:old')).toBeUndefined();
 await writeMusicCache('music-analysis:v2:wrong',{...audio,recognition:{...audio.recognition!,configurationHash:'old'}});
 expect(await readMusicCache('music-analysis:v2:wrong')).toBeUndefined();
});
it('refuses runs whose completion flag disagrees with unfinished, failed, or gapped jobs',async()=>{
 for(const [name,change] of [
  ['pending',(recognition:Recognition)=>{recognition.jobs[0].status='pending';}],
  ['failed',(recognition:Recognition)=>{recognition.jobs[0].status='failed';}],
  ['gapped',(recognition:Recognition)=>{recognition.jobs[0].successful=[{start:0,end:5}];recognition.jobs[0].gaps=[{start:5,end:10}];}],
 ] as const) {
  const recognition=completedRecognition();change(recognition);
  await writeMusicCache(`music-analysis:v2:${name}`,{...audio,recognition});
  expect(await readMusicCache(`music-analysis:v2:${name}`)).toBeUndefined();
 }
});
it('rejects stored ledgers that sanitize to pending, failed, or gapped jobs',async()=>{
 for(const [name,change] of [
  ['pending',(recognition:Recognition)=>{recognition.jobs[0].attempted=[];recognition.jobs[0].successful=[];}],
  ['failed',(recognition:Recognition)=>{recognition.jobs[0].successful=[];}],
  ['gapped',(recognition:Recognition)=>{const job=recognition.jobs[0];job.planned=[{start:0,end:5},{start:5,end:10}];job.attempted=[...job.planned];job.successful=[job.planned[0]];}],
 ] as const) {
  const persisted=structuredClone(audio);change(persisted.recognition!);
  db.values.set(`music-analysis:v2:stored-${name}`,{audio:persisted});
  expect(await readMusicCache(`music-analysis:v2:stored-${name}`)).toBeUndefined();
 }
});
it('allows the documented short-clip Jamendo exception only with an otherwise closed ledger',async()=>{
 const recognition=completedRecognition(2);const jamendo=recognition.jobs.find(job=>job.modelId==='jamendo')!;
 jamendo.status='unsupported';jamendo.unsupportedReason='At least 2.048 seconds of audio are required; no Jamendo inference ran.';jamendo.attempted=[];jamendo.successful=[];jamendo.gaps=[{start:0,end:2}];
 const short={...audio,durationSeconds:2,analyzedSeconds:2,instrumentScan:{complete:true,analyzedSeconds:2,windows:1},recognition};
 await writeMusicCache('music-analysis:v2:short',short);expect(await readMusicCache('music-analysis:v2:short')).toBeDefined();
 jamendo.unsupportedReason=undefined;await writeMusicCache('music-analysis:v2:missing-reason',{...short,recognition});expect(await readMusicCache('music-analysis:v2:missing-reason')).toBeUndefined();
});
it('works without a private learned model and invalidates when any encoder changes',async()=>{
 let ast='a'.repeat(64);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json({revision:'r',sha256:{'model.onnx':url.includes('music-model')?ast:'b'.repeat(64),'prompts.json':'c'.repeat(64)}})));
 const blob=new Blob(['audio']);const first=await musicCacheKey(blob,'full');expect(first).toBeDefined();
 ast='d'.repeat(64);expect(await musicCacheKey(blob,'full')).not.toBe(first);
});
it('fails closed when a manifest hash is not a SHA-256 digest',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({revision:'r',sha256:{'model.onnx':'not-a-hash'}})));
 expect(await musicCacheKey(new Blob(['audio']),'full')).toBeUndefined();
});

it.each(['full','fast'] as const)('caches completed %s plans with intentional unsampled gaps',async mode=>{
 const recognition=createRecognition(120,mode);
 for(const job of recognition.jobs){
  job.planned=mode==='fast'||job.modelId==='rhythm'||job.modelId==='tonal'?[{start:0,end:10},{start:110,end:120}]:[{start:0,end:120}];
  job.attempted=[...job.planned];job.successful=[...job.planned];finishJob(job,120);
 }
 recognition.status='complete';
 const result={...audio,durationSeconds:120,analyzedSeconds:20,recognition};
 await writeMusicCache('music-analysis:v2:sampled',result);
 expect(await readMusicCache('music-analysis:v2:sampled')).toBeDefined();
});
