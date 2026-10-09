import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {MUSIC_CACHE_LIMIT,musicCacheKey,musicCacheFingerprint,readMusicCache,writeMusicCache} from './musicAnalysisCache';
import { createRecognition, finishJob, type Recognition } from './recognition';
import { fusionPresentation } from './fusionPresentation';
import { sanitizeMusicAnalysis } from './musicTypes';
import { FUSION_LABELS, unavailableFusionDecisions, type FusionAnalysis } from './fusion';
import type { FusionReleaseIdentity } from './fusionRelease';
import type {MusicAnalysis} from './musicTypes';
const db=vi.hoisted(()=>{
 const values=new Map<string,unknown>();
 const store={get:async(k:string)=>values.get(k),put:async(v:unknown,k:string)=>{values.set(k,v);},getAllKeys:async()=>[...values.keys()],delete:async(k:string)=>{values.delete(k);}};
 return {values,store};
});
vi.mock('../persistence/db',()=>({getDb:async()=>({get:async(_store:string,k:string)=>db.store.get(k),transaction:()=>({store:db.store,done:Promise.resolve()})})}));
const releaseState=vi.hoisted(()=>({value:undefined as FusionReleaseIdentity|undefined}));
vi.mock('./fusionRelease',()=>({releaseForScorer:()=>undefined,installedFusionIdentity:()=>releaseState.value,fusionRuntimeSupported:()=>!!releaseState.value,fusionConfiguration:()=>JSON.stringify(releaseState.value??'disabled'),FUSION_MINIMUM_SECONDS:2.048,supportsFusionInput:(duration:number,mode:string)=>mode==='full'&&duration>=2.048,sanitizeFusionReleaseIdentity:(v:unknown)=>v,sameFusionRelease:(a:unknown,b:unknown)=>!!a&&!!b&&JSON.stringify(a)===JSON.stringify(b)}));
beforeEach(()=>{db.values.clear();releaseState.value=undefined;});afterEach(()=>vi.unstubAllGlobals());
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
 let now=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>++now);
 for(let i=0;i<MUSIC_CACHE_LIMIT;i++)await writeMusicCache('music-analysis:v2:'+i,audio);
 expect([...db.values.keys()].filter(k=>k.startsWith('music-analysis:v2:'))).toHaveLength(MUSIC_CACHE_LIMIT);
 await writeMusicCache('music-analysis:v2:newest',audio);
 const kept=[...db.values.keys()].filter(k=>k.startsWith('music-analysis:v2:'));
 expect(kept).toHaveLength(Math.floor(MUSIC_CACHE_LIMIT*.9));expect(kept).toContain('music-analysis:v2:newest');expect(kept).not.toContain('music-analysis:v2:0');expect(db.values.get('user-preference')).toBe(true);
 clock.mockRestore();
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

it('reuses a qualified fusion result and rejects one that was not fully scored',async()=>{
 const release: FusionReleaseIdentity={modelSha256:'a'.repeat(64),policySha256:'b'.repeat(64),scorerSha256:'c'.repeat(64),modelFileSha256:'d'.repeat(64),receiptSha256:'e'.repeat(64),runtimeSha256:'f'.repeat(64),inputTier:'ogg-full-ten-second-window-v1'};
 releaseState.value=release;
 const fusion: FusionAnalysis={version:1,scope:'window',validation:'policy-qualified',release,identity:release,planned:1,counts:{complete:1,failed:0,unsupported:0,empty:0},omittedWindows:0,windows:[{start:0,end:10,status:'complete',decisions:FUSION_LABELS.map(label=>({label,state:'negative',source:'learned-head',headProbability:.1,decisionProbability:.1,eligible:true,positiveGroups:3,negativeGroups:4}))}]};
 const qualified={...audio,fusion,classifierConfiguration:JSON.stringify(release)};
 expect(fusionPresentation(fusion,10,'full',release)?.qualified).toBe(true);
 expect(sanitizeMusicAnalysis(qualified,{trustedCache:true})?.fusion?.validation).toBe('policy-qualified');
 await writeMusicCache('music-analysis:v2:qualified',qualified,'audio/ogg');
 expect(db.values.has('music-analysis:v2:qualified')).toBe(true);
 expect((await readMusicCache('music-analysis:v2:qualified','audio/ogg'))?.fusion?.validation).toBe('policy-qualified');
 // Windows need not tile the whole recording: the analysis plan chooses what to scan,
 // and analyzedSeconds already reports the coverage. A shorter scanned window is reusable.
 for(const [start,end] of [[0,9],[1,10]]){
  const partial=structuredClone(qualified);partial.fusion.windows[0].start=start;partial.fusion.windows[0].end=end;
  db.values.set('music-analysis:v2:stored-partial',{audio:partial});
  expect((await readMusicCache('music-analysis:v2:stored-partial','audio/ogg'))?.fusion?.validation).toBe('policy-qualified');
 }
 // A window the scorer could not complete still invalidates the entry: that recording
 // was not fully scored, so a cached answer would understate what is present.
 for(const status of ['failed','unsupported'] as const){
  const broken=structuredClone(qualified);
  broken.fusion.windows[0]={start:0,end:10,status,decisions:unavailableFusionDecisions()};
  broken.fusion.counts={complete:0,failed:0,unsupported:0,empty:0};broken.fusion.counts[status]=1;
  db.values.set('music-analysis:v2:stored-broken',{audio:broken});
  expect(await readMusicCache('music-analysis:v2:stored-broken','audio/ogg')).toBeUndefined();
  await writeMusicCache('music-analysis:v2:rejected',broken,'audio/ogg');
  expect(db.values.has('music-analysis:v2:rejected')).toBe(false);
 }
});

// Independent reviewer integration regression; scratch only.
it('review: actual short analysis survives persistent cache with unsupported metadata and without reviews',async()=>{
 const {analyzeDecodedMusic}=await import('./analyzeDecodedMusic');
 const decoder={durationSeconds:.7,close(){},read:async(_start:number,seconds:number,rate:number)=>new Float32Array(Math.round(seconds*rate)).fill(.1)};
 const result=await analyzeDecodedMusic(decoder,async<T>(message:Record<string,unknown>):Promise<T>=>{
  if(message.kind==='instruments')return {scores:{piano:.95},musicScore:.9} as T;
  if(message.kind==='profile')return [{group:'tone',label:'distorted',score:.7},{group:'tone',label:'bright',score:.1}] as T;
  return {version:2,durationSeconds:.7,analyzedSeconds:.7,instruments:[],notes:[]} as T;
 },{});
 result.soundReviews=[{dimension:'character',labelId:'distorted',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:result.recognition!.runId}];
 await writeMusicCache('music-analysis:v2:review-real',result);
 const cached=await readMusicCache('music-analysis:v2:review-real');
 expect(cached?.recognition?.status).toBe('complete');
 expect(cached?.recognition?.jobs.find(j=>j.modelId==='jamendo')).toMatchObject({status:'unsupported',attempted:[],successful:[],analyzedSeconds:0});
 expect(cached?.recognition?.jobs.find(j=>j.modelId==='jamendo')?.unsupportedReason).toContain('2.048');
 expect(cached?.soundReviews).toBeUndefined();
 expect(cached?.recognition?.observations.every(o=>o.status==='possible')).toBe(true);
 expect(sanitizeMusicAnalysis(result)?.soundReviews).toEqual(result.soundReviews);
 const obsolete=structuredClone(result);obsolete.recognition!.configurationHash=obsolete.recognition!.configurationHash.replace(':short-unsupported-completion-v1','');
 db.values.set('music-analysis:v2:review-obsolete',{audio:obsolete});
 expect(await readMusicCache('music-analysis:v2:review-obsolete')).toBeUndefined();
});

it('does not reuse a key from an older method or the fallback profiles',async()=>{
 const {KEY_ANALYSIS_REVISION}=await import('./musicTypes');
 await writeMusicCache('music-analysis:v2:fallback-key',{...audio,keyRevision:KEY_ANALYSIS_REVISION-1});
 expect(await readMusicCache('music-analysis:v2:fallback-key')).toBeUndefined();
 await writeMusicCache('music-analysis:v2:current-key',{...audio,keyRevision:KEY_ANALYSIS_REVISION});
 expect(await readMusicCache('music-analysis:v2:current-key')).toBeDefined();
});

it('shares one digest and manifest snapshot within a batch, but refreshes on a new batch', async () => {
 const { createMusicCacheContext } = await import('./musicAnalysisCache');
 const fetcher = vi.fn(async () => Response.json({sha256:{'model.onnx':'a'.repeat(64)}}));
 vi.stubGlobal('fetch', fetcher);
 const blob = new Blob(['audio']); const read = vi.spyOn(blob, 'arrayBuffer');
 const context = createMusicCacheContext();
 const [fingerprint, quick, full] = await Promise.all([context.fingerprint(blob), musicCacheKey(blob, 'fast', context), musicCacheKey(blob, 'full', context)]);
 expect(fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(quick).not.toBe(full);
 expect(read).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(4);
 await musicCacheKey(blob, 'full', createMusicCacheContext());
 expect(fetcher).toHaveBeenCalledTimes(8);
});
it('retries a failed manifest snapshot within the same batch', async () => {
 const { createMusicCacheContext } = await import('./musicAnalysisCache');
 let available = false;
 const fetcher = vi.fn(async () => available ? Response.json({sha256:{'model.onnx':'a'.repeat(64)}}) : new Response('', {status:503}));
 vi.stubGlobal('fetch', fetcher);
 const context = createMusicCacheContext(), blob = new Blob(['audio']);
 expect(await musicCacheKey(blob, 'fast', context)).toBeUndefined();
 available = true;
 expect(await musicCacheKey(blob, 'fast', context)).toBeDefined();
 expect(fetcher).toHaveBeenCalledTimes(8);
});
