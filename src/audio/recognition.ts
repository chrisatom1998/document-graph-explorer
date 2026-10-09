import { FUSION_LABELS } from './fusion';
import { KEY_CNN_FEATURES, KEY_CNN_WEIGHTS } from './keyCnn';
import { TEMPO_CNN_WEIGHTS } from './tempoCnn';
import { musicRuntimeIdentity } from './musicRuntime';
import ast from '../../public/music-model/manifest.json';
import clap from '../../public/sound-model/manifest.json';
import { SHORT_CLIP_MAX_SECONDS } from './shortClipModel';
import jamendo from '../../public/jamendo-model/manifest.json';
import { EFFECT_EVENT_LABELS } from './soundReviewPolicy';
import { DJ_LABELS } from './djTags';
import { INSTRUMENT_LABELS } from './instrumentLabels';
import { CHARACTER_LABELS, ROLE_LABELS, VOCAL_LABELS } from './soundProfile';
import { canonicalReviewLabel, sharedSoundReviewIdentity } from './soundReviewIdentity';
export type Interval = { start: number; end: number };
export type ModelId = 'ast' | 'jamendo' | 'clap' | 'rhythm' | 'tonal';
export type Dimension = 'source' | 'vocal' | 'role' | 'character' | 'effect';
export interface SoundReview {
  dimension: Dimension; labelId: string; decision: 'confirmed' | 'rejected' | 'uncertain';
  scope: 'track'; at: string; evidenceRunId: string;
}
export type JobStatus = 'pending' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled' | 'unsupported';
export interface ModelJob {
  modelId: ModelId; weightsVersion: string; preprocessingVersion: string; promptVersion?: string;
  status: JobStatus; planned: Interval[]; attempted: Interval[]; successful: Interval[];
  analyzedSeconds: number; gaps: Interval[]; error?: string; unsupportedReason?: string;
}
export interface Evidence extends Interval {
  id: string; modelId: ModelId; dimension: Dimension; labelId: string; score: number;
  validSeconds: number; inputSeconds: number; aggregation: 'window';
  padding: 'none' | 'repeatpad-to-10s' | 'feature-pad-to-1024-frames' | 'centered-mel-frames';
  /** The qualifying CLAP prompt when voice is inferred from a vocal form. */
  derivedFrom?: { group: 'sample' | 'vocal'; labelId: string };
}
export type EvidenceCandidate = Pick<Evidence, 'dimension' | 'labelId' | 'score' | 'derivedFrom'>;
export interface Observation extends Interval {
  id: string; dimension: Dimension; labelId: string; familyId: string;
  evidenceIds: string[]; status: 'possible' | 'accepted'; confidence?: number;
}
export interface Recognition {
  schemaVersion: 1; runId: string; audioFingerprint?: string; configurationHash: string;
  startedAt: string; endedAt?: string; status: JobStatus; cancellationReason?: string;
  mode: 'fast' | 'full'; jobs: ModelJob[]; evidence: Evidence[]; observations: Observation[];
  calibration: 'unvalidated'; truncated?: boolean;
}
export const MODEL_IDS: ModelId[] = ['ast','jamendo','clap','rhythm','tonal'];
export const DIMENSIONS: Dimension[] = ['source','vocal','role','character','effect'];
export const MAX_EVIDENCE = 12000;
export const MAX_INTERVALS = 20000;
const paddingFor = (model:ModelId):Evidence['padding'] => model==='clap'?'repeatpad-to-10s':model==='ast'?'feature-pad-to-1024-frames':model==='jamendo'?'centered-mel-frames':'none';
const extras = ['oboe','viola','bongo','conga','tuba','bassoon','horn','melodica','drum machine','environmental sound','noise'];
export const sourceLabels = [...new Set([...INSTRUMENT_LABELS,...extras,...DJ_LABELS.source,...FUSION_LABELS])];
export const dimensionLabels: Record<Dimension, string[]> = {
  source: sourceLabels, vocal: VOCAL_LABELS, role: [...ROLE_LABELS,'chord','texture'],
  character: [...new Set([...CHARACTER_LABELS,...DJ_LABELS.character])], effect: ['atmosphere',...EFFECT_EVENT_LABELS],
};
export function familyOf(label: string): string {
  if (label === 'voice') return 'voice';
  if (label === 'bass drum') return 'drums';
  if (label === 'bassoon') return 'woodwind';
  if (label === 'harpsichord') return 'keys';
  if (/synth|sampler|theremin/.test(label)) return 'synthesizer';
  if (/guitar|violin|viola|cello|bass|harp|banjo|sitar|ukulele|string|mandolin|zither/.test(label)) return 'strings';
  if (/oboe|flute|clarinet|sax|bassoon|woodwind|bagpipe|didgeridoo/.test(label)) return 'woodwind';
  if (/trumpet|trombone|tuba|horn|brass|shofar/.test(label)) return 'brass';
  if (/piano|organ|keyboard|harpsichord|accordion|harmonica|melodica/.test(label)) return 'keys';
  if (/drum|hi-hat|cymbal|timpani/.test(label)) return 'drums';
  if (/bongo|conga|percussion|tabla|bell|maraca|gong|chime|rattle|tambourine|marimba|vibraphone|glockenspiel|steelpan|wood block|singing bowl/.test(label)) return 'percussion';
  return 'unknown';
}
/** One-shot heads change what short clips display, and full analyses of long recordings use them on event windows
 * (analyzeDecodedMusic eventPass): a new file re-runs both. Fast long analyses never use them and stay current. */
const oneShotIdentity = `one-shot-${((clap.sha256 as Record<string, string>)['short-clip.json'] ?? 'none').slice(0, 12)}-prompts-${clap.sha256['prompts.json'].slice(0, 12)}`;
export const recognitionConfiguration = (mode: 'fast' | 'full', durationSeconds?: number) => `timeline-v1:${mode}:decoder-mono-v3-short-pcm:${musicRuntimeIdentity()}:labels-v2:voice-evidence-v1:dj-catalog-v2:effect-routing-v1:short-unsupported-completion-v1:audio-mime-v1:pinned-models-required-v1${durationSeconds !== undefined && durationSeconds <= SHORT_CLIP_MAX_SECONDS ? `:${oneShotIdentity}` : mode === 'full' && durationSeconds !== undefined ? `:event-windows-v1:${oneShotIdentity}` : ''}:uncalibrated`;
export function createRecognition(duration: number, mode: 'fast' | 'full', audioFingerprint?: string): Recognition {
  // Checksum prefixes keep the growing Jamendo asset list inside the 512-character ledger bound.
  const versions = [ast.revision, Object.values(jamendo.sha256).map(hash => hash.slice(0, 16)).join(':'), clap.revision, `${TEMPO_CNN_WEIGHTS}:essentia-0.1.3-tempo-1`, `${KEY_CNN_WEIGHTS}:essentia-0.1.3-key-4`];
  return { schemaVersion:1, runId:crypto.randomUUID(), audioFingerprint, configurationHash:recognitionConfiguration(mode,duration),
    startedAt:new Date().toISOString(),status:'running',mode,calibration:'unvalidated',evidence:[],observations:[],
    jobs:MODEL_IDS.map((modelId,i)=>({modelId,weightsVersion:versions[i],preprocessingVersion:'decoder-mono-v3-short-pcm:'+(['ast','jamendo','clap'].includes(modelId)?musicRuntimeIdentity(modelId)+':':'')+(['ast','jamendo'].includes(modelId)?16000:modelId==='clap'?48000:44100)+':'+(modelId==='ast'?ast.sha256['preprocessor_config.json']+':webgpu-fp32-allowed':modelId==='clap'?clap.sha256['preprocessor_config.json']:modelId==='tonal'?`features-v1:${KEY_CNN_FEATURES}`:'features-v1'),
      ...(modelId==='clap'?{promptVersion:clap.sha256['prompts.json']}:{}),status:'pending',planned:[],attempted:[],successful:[],analyzedSeconds:0,gaps:duration>0?[{start:0,end:duration}]:[]})) };
}
/** A threaded-runtime stall switches this browser to one inference thread mid-run. Stamp the finished ledger
 * with the runtime that actually produced it, so the cache and the coordinator treat the result as current. */
export function refreshRuntimeIdentity(recognition: Recognition, duration: number): void {
  const fresh = createRecognition(duration, recognition.mode);
  recognition.configurationHash = fresh.configurationHash;
  for (const job of recognition.jobs) job.preprocessingVersion = fresh.jobs.find(j => j.modelId === job.modelId)?.preprocessingVersion ?? job.preprocessingVersion;
}
export function unionIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[]=[];
  for(const interval of [...intervals].sort((a,b)=>a.start-b.start)) {
    const last=result.at(-1);
    if(last && interval.start<=last.end+.00001) last.end=Math.max(last.end,interval.end);
    else result.push({...interval});
  }
  return result;
}
export function finishJob(job: ModelJob, duration: number, cancelled=false): void {
  const unique=(items:Interval[])=>[...new Map(items.map(i=>[`${i.start}:${i.end}`,i])).values()];
  job.planned=unique(job.planned);job.attempted=unique(job.attempted);job.successful=unique(job.successful);
  const covered=unionIntervals(job.successful);job.analyzedSeconds=covered.reduce((n,i)=>n+i.end-i.start,0);
  let cursor=0;job.gaps=[];
  for(const interval of covered) { if(interval.start>cursor) job.gaps.push({start:cursor,end:interval.start});cursor=Math.max(cursor,interval.end); }
  if(cursor<duration) job.gaps.push({start:cursor,end:duration});
  const success=new Set(job.successful.map(i=>`${i.start}:${i.end}`));
  const complete=job.planned.length>0&&job.planned.every(i=>success.has(`${i.start}:${i.end}`));
  if(job.unsupportedReason){job.status='unsupported';return;}
  job.status=cancelled && !complete?'cancelled':complete?'complete':job.successful.length?'partial':job.attempted.length?'failed':'pending';
}
export function recordEvidence(run: Recognition, modelId: ModelId, interval: Interval, candidates: EvidenceCandidate[]): void {
  for(const candidate of candidates) {
    if(!dimensionLabels[candidate.dimension].includes(candidate.labelId) || !Number.isFinite(candidate.score) || candidate.score < -1 || candidate.score > 1) continue;
    const id=`${modelId}:${interval.start}:${interval.end}:${candidate.dimension}:${candidate.labelId}`;
    if(run.evidence.some(e=>e.id===id)) continue;
    if(run.evidence.length>=MAX_EVIDENCE) { run.truncated=true;return; }
    run.evidence.push({id,modelId,...interval,...candidate,validSeconds:interval.end-interval.start,inputSeconds:interval.end-interval.start,aggregation:'window',padding:paddingFor(modelId)});
    // Coalesce only the same label in exactly the same window; never invent event boundaries.
    const observationId=`${candidate.dimension}:${candidate.labelId}:${interval.start}:${interval.end}`;
    const old=run.observations.find(o=>o.id===observationId);
    if(old) old.evidenceIds.push(id);
    else run.observations.push({id:observationId,dimension:candidate.dimension,labelId:candidate.labelId,familyId:candidate.dimension==='source'?familyOf(candidate.labelId):candidate.dimension,...interval,evidenceIds:[id],status:'possible'});
  }
}
export function modelCacheKey(fingerprint:string, job:ModelJob, interval:Interval):string {
  return JSON.stringify([fingerprint,job.modelId,job.weightsVersion,job.preprocessingVersion,job.promptVersion??'',interval.start,interval.end,'labels-v2:raw-v1']);
}
/** Small LRU of model outputs, never PCM or unbounded track histories. */
export class ResultCache {
  private values=new Map<string,unknown>();
  constructor(private capacity=128) { if(!Number.isInteger(capacity)||capacity<0)throw new Error('Cache capacity must be a nonnegative integer'); }
  get size() { return this.values.size; }
  get<T>(key:string):T|undefined { const v=this.values.get(key);if(v===undefined)return;this.values.delete(key);this.values.set(key,v);return structuredClone(v) as T; }
  set(key:string,value:unknown):void { this.values.delete(key);this.values.set(key,structuredClone(value));while(this.values.size>this.capacity)this.values.delete(this.values.keys().next().value!); }
}
const object=(v:unknown):Record<string,unknown>|undefined=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const boundedString=(v:unknown,max=512):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
const number=(v:unknown,max:number,min=0):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const validInterval=(v:unknown,duration:number):v is Interval & Record<string,unknown>=>!!object(v)&&number(object(v)!.start,duration)&&number(object(v)!.end,duration)&&Number(object(v)!.end)>Number(object(v)!.start);
export function sanitizeSoundReviews(raw:unknown):SoundReview[] {
  if(!Array.isArray(raw))return [];
  return raw.slice(0,500).flatMap(value=>{
    const r=object(value);
    if(!r||!DIMENSIONS.includes(r.dimension as Dimension)||typeof r.labelId!=='string')return [];
    const dimension = r.dimension as Dimension;
    const sharedIdentity = sharedSoundReviewIdentity(dimension, r.labelId);
    // Persist the declared source/effect equivalents without expanding detector vocabulary.
    const labelId = sharedIdentity ? canonicalReviewLabel(dimension, r.labelId) : r.labelId;
    if((!dimensionLabels[dimension].includes(labelId)&&!sharedIdentity)
      ||!['confirmed','rejected','uncertain'].includes(r.decision as string)||r.scope!=='track'||!boundedString(r.at)||!Number.isFinite(Date.parse(r.at))||!boundedString(r.evidenceRunId))return [];
    return [{dimension,labelId,decision:r.decision as SoundReview['decision'],scope:'track' as const,at:r.at,evidenceRunId:r.evidenceRunId}];
  });
}
export function sanitizeRecognition(raw:unknown,duration:number):Recognition|undefined {
  const r=object(raw);
  if(!r||r.schemaVersion!==1||!boundedString(r.runId)||!boundedString(r.configurationHash)||!boundedString(r.startedAt)||!Array.isArray(r.jobs)||!Array.isArray(r.evidence)||!Array.isArray(r.observations))return;
  const out=createRecognition(duration,r.mode==='fast'?'fast':'full');out.runId=r.runId;out.configurationHash=r.configurationHash;out.startedAt=r.startedAt;
  if(boundedString(r.endedAt))out.endedAt=r.endedAt;
  if(boundedString(r.audioFingerprint))out.audioFingerprint=r.audioFingerprint;
  if(boundedString(r.cancellationReason))out.cancellationReason=r.cancellationReason;
  out.status=['complete','partial','failed','cancelled'].includes(String(r.status))?r.status as JobStatus:'partial';
  out.truncated=r.truncated===true;out.jobs=[];
  const intervals=(v:unknown)=>Array.isArray(v)?v.slice(0,MAX_INTERVALS).filter(i=>validInterval(i,duration)).map(i=>({start:i.start,end:i.end})):[];
  for(const v of r.jobs.slice(0,5)) {
    const j=object(v);if(!j||!MODEL_IDS.includes(j.modelId as ModelId)||out.jobs.some(x=>x.modelId===j.modelId)||!boundedString(j.weightsVersion)||!boundedString(j.preprocessingVersion))continue;
    const planned=intervals(j.planned);const plannedKeys=new Set(planned.map(i=>`${i.start}:${i.end}`));
    const attempted=intervals(j.attempted).filter(a=>plannedKeys.has(`${a.start}:${a.end}`));
    const attemptedKeys=new Set(attempted.map(i=>`${i.start}:${i.end}`));
    const successful=intervals(j.successful).filter(a=>attemptedKeys.has(`${a.start}:${a.end}`));
    const job:ModelJob={modelId:j.modelId as ModelId,weightsVersion:j.weightsVersion,preprocessingVersion:j.preprocessingVersion,status:'partial',planned,attempted,successful,analyzedSeconds:0,gaps:[]};
    if(boundedString(j.promptVersion))job.promptVersion=j.promptVersion;
    if(boundedString(j.error))job.error=j.error;
    if(job.modelId==='jamendo' && duration<2.048 && typeof j.unsupportedReason==='string' && !successful.length) job.unsupportedReason=j.unsupportedReason.slice(0,300);
    finishJob(job,duration,j.status==='cancelled');out.jobs.push(job);
  }
  const evidenceIds=new Set<string>();
  for(const v of r.evidence.slice(0,MAX_EVIDENCE)) {
    const e=object(v);if(!e||!validInterval(e,duration)||!boundedString(e.id)||!MODEL_IDS.includes(e.modelId as ModelId)||!DIMENSIONS.includes(e.dimension as Dimension)||!dimensionLabels[e.dimension as Dimension].includes(String(e.labelId))||!number(e.score,1,-1)||evidenceIds.has(e.id))continue;
    let derivedFrom: Evidence['derivedFrom'];
    if(e.derivedFrom!==undefined) {
      const basis=object(e.derivedFrom);
      if(e.modelId!=='clap'||e.dimension!=='source'||e.labelId!=='voice'||!basis||
        !(basis.group==='sample'&&basis.labelId==='vocal chops'||basis.group==='vocal'&&VOCAL_LABELS.includes(String(basis.labelId))))continue;
      derivedFrom={group:basis.group as 'sample'|'vocal',labelId:String(basis.labelId)};
    }
    evidenceIds.add(e.id);
    out.evidence.push({id:e.id,modelId:e.modelId as ModelId,dimension:e.dimension as Dimension,labelId:String(e.labelId),start:e.start,end:e.end,score:e.score,validSeconds:e.end-e.start,inputSeconds:number(e.inputSeconds,90)?Math.max(e.end-e.start,e.inputSeconds):e.end-e.start,aggregation:'window',padding:paddingFor(e.modelId as ModelId),...(derivedFrom?{derivedFrom}:{})});
  }
  const evidence=new Map(out.evidence.map(e=>[e.id,e]));
  const observationIds=new Set<string>();
  for(const v of r.observations.slice(0,MAX_EVIDENCE)) {
    const o=object(v);if(!o||!validInterval(o,duration)||!boundedString(o.id)||!DIMENSIONS.includes(o.dimension as Dimension)||!dimensionLabels[o.dimension as Dimension].includes(String(o.labelId))||!Array.isArray(o.evidenceIds)||observationIds.has(o.id))continue;
    observationIds.add(o.id);
    const ids=[...new Set(o.evidenceIds.filter((id):id is string=>typeof id==='string'&&evidence.get(id)?.dimension===o.dimension&&evidence.get(id)?.labelId===o.labelId&&evidence.get(id)?.start===o.start&&evidence.get(id)?.end===o.end))].slice(0,5);
    if(ids.length)out.observations.push({id:o.id,dimension:o.dimension as Dimension,labelId:String(o.labelId),familyId:o.dimension==='source'?familyOf(String(o.labelId)):String(o.dimension),start:o.start,end:o.end,evidenceIds:ids,status:'possible'});
  }
  return out;
}
