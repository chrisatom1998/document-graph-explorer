import {getDb} from '../persistence/db';
import {sanitizeMusicAnalysis,INSTRUMENT_ANALYSIS_REVISION,TEMPO_ANALYSIS_REVISION,KEY_ANALYSIS_REVISION,type MusicAnalysis,type MusicAnalysisMode} from './musicTypes';
import { MODEL_IDS,recognitionConfiguration,type ModelJob } from './recognition';
const PREFIX='music-analysis:v2:';
const LIMIT=100;
export async function musicCacheKey(blob:Blob,mode:MusicAnalysisMode):Promise<string|undefined>{
 try {
  const manifests=await Promise.all(['music-model','jamendo-model','sound-model'].map(async directory=>{
   const response=await fetch(`${import.meta.env.BASE_URL}${directory}/manifest.json`,{cache:'no-cache',signal:AbortSignal.timeout(2000)});
   if(!response.ok)throw new Error('Model manifest unavailable');
   const manifest=await response.json();
   if(!manifest.sha256 || typeof manifest.sha256!=='object'||Array.isArray(manifest.sha256)||!Object.entries(manifest.sha256).length
    ||!Object.entries(manifest.sha256).every(([name,hash])=>typeof name==='string'&&name.length>0&&typeof hash==='string'&&/^[a-f0-9]{64}$/i.test(hash)))throw new Error('Model hashes unavailable');
   return [directory,manifest.revision??'',Object.entries(manifest.sha256).sort(([a],[b])=>a.localeCompare(b))];
  }));
  const bytes=await blob.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return PREFIX+JSON.stringify([hash,mode,INSTRUMENT_ANALYSIS_REVISION,TEMPO_ANALYSIS_REVISION,KEY_ANALYSIS_REVISION,recognitionConfiguration(mode),manifests]);
 }catch{return undefined;}
}
const intervalKey=({start,end}:{start:number;end:number})=>`${start}:${end}`;
function closedJob(job:ModelJob):boolean {
 if(job.status!=='complete'||!job.planned.length)return false;
 const planned=new Set(job.planned.map(intervalKey));
 const attempted=new Set(job.attempted.map(intervalKey));
 const successful=new Set(job.successful.map(intervalKey));
 return job.attempted.every(interval=>planned.has(intervalKey(interval)))
  && job.successful.every(interval=>planned.has(intervalKey(interval))&&attempted.has(intervalKey(interval)))
  && [...planned].every(key=>attempted.has(key)&&successful.has(key));
}
/** A sub-2.048s clip deliberately skips Jamendo; its completed instrument scan is still reusable. */
function shortClipJamendoUnsupported(job:ModelJob,duration:number):boolean {
 return job.modelId==='jamendo'&&duration<2.048&&job.status==='unsupported'&&!!job.unsupportedReason
  && !job.attempted.length&&!job.successful.length;
}
function completeCurrent(audio:MusicAnalysis|undefined):boolean {
 const recognition=audio?.recognition;
 if(!audio?.instrumentScan?.complete||audio.stage==='preview'||recognition?.status!=='complete'||recognition.configurationHash!==recognitionConfiguration(recognition.mode))return false;
 if(recognition.jobs.length!==MODEL_IDS.length||new Set(recognition.jobs.map(job=>job.modelId)).size!==MODEL_IDS.length)return false;
 return recognition.jobs.every(job=>closedJob(job)||shortClipJamendoUnsupported(job,audio.durationSeconds));
}
export async function readMusicCache(key:string):Promise<MusicAnalysis|undefined>{
 try {const entry=await (await getDb()).get('settings',key) as {audio?:unknown}|undefined;
  const audio=sanitizeMusicAnalysis(entry?.audio);
  return completeCurrent(audio)?audio:undefined;
 }catch{return undefined;}
}
export async function writeMusicCache(key:string,audio:MusicAnalysis):Promise<void>{
 if(!completeCurrent(audio))return;
 const {confirmedDjTags:_tags,confirmedInstruments:_instruments,copilotProperties:_copilot,soundReviews:_reviews,...automatic}=audio;
 void _tags;void _instruments;void _copilot;void _reviews;
 try {
  const db=await getDb(),tx=db.transaction('settings','readwrite');
  void tx.done.catch(()=>{});
  await tx.store.put({audio:automatic,savedAt:Date.now()},key);
  const keys=(await tx.store.getAllKeys()).filter(k=>k.startsWith(PREFIX));
  if(keys.length>LIMIT){
   const entries=await Promise.all(keys.map(async k=>({key:k,savedAt:((await tx.store.get(k)) as {savedAt?:number})?.savedAt??0})));
   entries.sort((a,b)=>a.savedAt-b.savedAt);
   for(const entry of entries.slice(0,entries.length-LIMIT))await tx.store.delete(entry.key);
  }
  await tx.done;
 }catch{/* Cache failures never prevent analysis. */}
}
export function musicCacheFingerprint(key:string):string {return JSON.stringify(JSON.parse(key.slice(PREFIX.length)).slice(2));}
