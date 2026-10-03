import jamendoMetadata from '../../audio-decode-fix/public/jamendo-model/mtg_jamendo_instrument-discogs-effnet-1.json' with {type:'json'};
export const JAMENDO_CLASSES:readonly string[]=Object.freeze([...jamendoMetadata.classes].sort());
/** Isolated research prototype. No fetching, audio decoding, fitting, label reads,
 * native-job mutation, track aggregation, or app promotion. */
export const LABELS = ['accordion','banjo','bass','cello','clarinet','cymbals','drums','flute','guitar','mallet_percussion','mandolin','organ','piano','saxophone','synthesizer','trombone','trumpet','ukulele','violin','voice'] as const;
export type Label = typeof LABELS[number];
export type State = 'positive'|'negative'|'uncertain';
type Identity = [string,string|null,string|null,string|null,string|null];
type MapOf<T> = Record<Label,T>;
type Head = {weights:number[];bias:number;featureNames:string[];positiveGroups:number;negativeGroups:number};
type Model = {
  version:1;family:'scores_no_jamendo'|'full_scores_no_jamendo';modelSha256:string;dataSelectionSha256:string;promptsSha256:string;
  labels:Label[];eligibility:MapOf<boolean>;canonicalAstOrder:string[];clapDescriptionOrder:Identity[];
  aliases:MapOf<string[]>;jamendoAliases:MapOf<string[]>;expandedClapAliases:MapOf<string[]>;heads:MapOf<Head>;
};
export type SelectedPolicy = {
  schemaVersion:1;kind:'openmic-fusion-selected-policy';featureContract:'browser-openmic-score-heads-v1';
  modelSha256:string;modelFileSha256:string;dataSelectionSha256:string;promptsSha256:string;
  adapterSourceSha256:string;baselineRulesSha256:string;labels:Label[];
  variant:'guardedHybrid'|'rawHeads';threshold:number;margin:0|0.02|0.05|0.1;
};
export type Descriptor={group:string;label:string|null;score:number;alternative?:string;learnedGroup?:string;decision?:string};
export type RawScores={ast:{instruments:Record<string,number>};jamendo:Record<string,number>;clap:{descriptions:Descriptor[]}};
export type WindowInput={
  windowId:string;start:number;end:number;inputSha256:string;pipelineHash:string;rawSha256:string;
  pcm:{samples16k:number;samples48k:number;sha256_16k:string;sha256_48k:string};
  raw:RawScores;
  baseline:{labels:Label[];rulesSha256:string;windowId:string;rawSha256:string};
};
export type FusionDecision={
  label:Label;state:State;headProbability:number;decisionProbability:number|null;
  decisionSource:'learned-head'|'guarded-binary-baseline';eligible:boolean;
  positiveGroups:number;negativeGroups:number;constituentFamilies:readonly string[];
};
export type FusionWindow={
  kind:'openmic-fusion';scope:'window';windowId:string;start:number;end:number;
  labels:readonly Label[];decisions:readonly FusionDecision[];
  counts:{positive:number;negative:number;uncertain:number;baselineFallback:number;total:20};
  provenance:{modelFileSha256:string;modelSha256:string;policyFileSha256:string;adapterSourceSha256:string;baselineRulesSha256:string;promptsSha256:string;pipelineHash:string;inputSha256:string;rawSha256:string};
  coverage:{validSeconds:number;samples16k:number;samples48k:number};
};
const APPROVED_SELECTION='4aee29d9debd611b45a02325877ac2a212178c7f8d7bb404503a399c71d8237d';
const check:(ok:unknown,message:string)=>asserts ok=(ok,message)=>{if(!ok)throw Error(message);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const allClassKeys=(v:unknown):v is MapOf<unknown>=>object(v)&&equal(Object.keys(v).sort(),LABELS);
const identity=(d:Descriptor):Identity=>[d.group,d.label,d.alternative??null,d.learnedGroup??null,d.decision??null];
const logit=(p:number)=>{p=Math.max(1e-6,Math.min(1-1e-6,p));return Math.log(p/(1-p));};
const freezeDeep=<T>(value:T):Readonly<T>=>{if(value&&typeof value==='object'){Object.values(value).forEach(v=>freezeDeep(v));Object.freeze(value);}return value;};
export async function sha256(bytes:Uint8Array):Promise<string>{
  const copy=new Uint8Array(bytes);const digest=await crypto.subtle.digest('SHA-256',copy);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

function parseModel(value:unknown):Model {
  check(object(value)&&value.version===1,'Invalid model envelope');
  check(value.family==='scores_no_jamendo'||value.family==='full_scores_no_jamendo','Unqualified head family');
  check(digest(value.modelSha256)&&value.dataSelectionSha256===APPROVED_SELECTION&&digest(value.promptsSha256),'Invalid model provenance');
  check(equal(value.labels,LABELS)&&allClassKeys(value.eligibility)&&Object.values(value.eligibility).every(v=>typeof v==='boolean'),'Invalid all20 labels/eligibility');
  check(Array.isArray(value.canonicalAstOrder)&&value.canonicalAstOrder.length===67&&value.canonicalAstOrder.every(s=>typeof s==='string'&&s.length>0)&&new Set(value.canonicalAstOrder).size===67&&equal([...value.canonicalAstOrder].sort(),value.canonicalAstOrder),'Invalid canonical AST order');
  check(Array.isArray(value.clapDescriptionOrder)&&value.clapDescriptionOrder.length===512,'Invalid CLAP descriptor order');
  for(const d of value.clapDescriptionOrder)check(Array.isArray(d)&&d.length===5&&typeof d[0]==='string'&&d.slice(1).every((v:unknown)=>v===null||typeof v==='string')&&d[3]===null&&d[4]===null,'Unqualified descriptor identity');
  for(const key of ['aliases','jamendoAliases','expandedClapAliases']){
    const map=value[key];check(allClassKeys(map)&&Object.values(map).every(a=>Array.isArray(a)&&a.every(v=>typeof v==='string')),'Invalid alias map');
  }
  const names=value.family==='full_scores_no_jamendo'?[...value.canonicalAstOrder.map(s=>'astLogit:'+s),...Array.from({length:512},(_,i)=>'clapScore:'+i)]:['ast','clapLegacy','clapExpanded','astMissing','clapLegacyMissing','clapExpandedMissing'];
  check(allClassKeys(value.heads),'Missing class head');
  for(const h of Object.values(value.heads)){
    check(object(h)&&equal(h.featureNames,names)&&Array.isArray(h.weights)&&h.weights.length===names.length&&h.weights.every(finite)&&finite(h.bias),'Invalid head dimensions/coefficient contract');
    check(Number.isInteger(h.positiveGroups)&&Number(h.positiveGroups)>=0&&Number.isInteger(h.negativeGroups)&&Number(h.negativeGroups)>=0,'Missing class support');
  }
  return value as unknown as Model;
}
function parsePolicy(value:unknown):SelectedPolicy {
  check(object(value)&&value.schemaVersion===1&&value.kind==='openmic-fusion-selected-policy'&&value.featureContract==='browser-openmic-score-heads-v1','Not a final selected policy');
  for(const k of ['modelSha256','modelFileSha256','promptsSha256','adapterSourceSha256','baselineRulesSha256'])check(digest(value[k]),'Invalid policy hash '+k);
  check(value.dataSelectionSha256===APPROVED_SELECTION&&equal(value.labels,LABELS),'Invalid selected-policy taxonomy/data');
  check(value.variant==='guardedHybrid'||value.variant==='rawHeads','Unknown selected variant');
  check(finite(value.threshold)&&Array.from({length:91},(_,i)=>(i+5)/100).includes(value.threshold)&&finite(value.margin)&&[0,.02,.05,.1].includes(value.margin),'Policy outside declared threshold/margin grid');
  check(!('thresholds'in value)&&!('globalThresholds'in value)&&!('margins'in value),'Search grid cannot serve as selected policy');
  return value as unknown as SelectedPolicy;
}
type Internal={model:Readonly<Model>;policy:Readonly<SelectedPolicy>;policyFileSha256:string};
// Callers cannot manufacture a bound adapter by passing an arbitrary model object.
const internals=new WeakMap<object,Internal>();
export type BoundFusion=Readonly<{kind:'bound-openmic-fusion';modelFileSha256:string;policyFileSha256:string}>;
export async function bindFrozenArtifacts(input:{
  modelBytes:Uint8Array;policyBytes:Uint8Array;adapterSourceBytes:Uint8Array;baselineRulesBytes:Uint8Array;promptsBytes:Uint8Array;
  expectedPolicyFileSha256:string;expectedAdapterSourceSha256:string;
}):Promise<BoundFusion>{
  // Snapshot caller-owned bytes before any await, so hashed and parsed bytes stay identical.
  input={...input,modelBytes:new Uint8Array(input.modelBytes),policyBytes:new Uint8Array(input.policyBytes),adapterSourceBytes:new Uint8Array(input.adapterSourceBytes),baselineRulesBytes:new Uint8Array(input.baselineRulesBytes),promptsBytes:new Uint8Array(input.promptsBytes)};
  check(digest(input.expectedPolicyFileSha256)&&digest(input.expectedAdapterSourceSha256),'Missing independently pinned policy/source hash');
  const [modelFileSha256,policyFileSha256,adapterSourceSha256,baselineRulesSha256,promptsSha256]=await Promise.all([input.modelBytes,input.policyBytes,input.adapterSourceBytes,input.baselineRulesBytes,input.promptsBytes].map(sha256));
  check(policyFileSha256===input.expectedPolicyFileSha256&&adapterSourceSha256===input.expectedAdapterSourceSha256,'Pinned policy/source bytes changed');
  const text=new TextDecoder(),model=parseModel(JSON.parse(text.decode(input.modelBytes))),policy=parsePolicy(JSON.parse(text.decode(input.policyBytes)));
  check(policy.modelFileSha256===modelFileSha256&&policy.modelSha256===model.modelSha256&&policy.promptsSha256===promptsSha256&&model.promptsSha256===promptsSha256&&policy.adapterSourceSha256===adapterSourceSha256&&policy.baselineRulesSha256===baselineRulesSha256,'Frozen artifact hash mismatch');
  const prompts:unknown=JSON.parse(text.decode(input.promptsBytes));check(Array.isArray(prompts)&&prompts.length===512,'Invalid pinned prompt file');
  const expected=prompts.map(p=>{check(object(p)&&typeof p.group==='string'&&(p.label===null||typeof p.label==='string'),'Invalid pinned prompt');return[p.group,p.label,p.label===null&&p.prompt?p.prompt:null,null,null];});
  check(equal(expected,model.clapDescriptionOrder),'Export order differs from pinned prompts');
  const bound=Object.freeze({kind:'bound-openmic-fusion' as const,modelFileSha256,policyFileSha256});
  internals.set(bound,{model:freezeDeep(model),policy:freezeDeep(policy),policyFileSha256});return bound;
}

function validateWindow(w:WindowInput,m:Readonly<Model>,p:Readonly<SelectedPolicy>):void {
  check(object(w)&&object(w.pcm)&&object(w.baseline)&&object(w.raw)&&object(w.raw.ast)&&object(w.raw.clap),'Incomplete fusion window envelope');
  check(typeof w.windowId==='string'&&w.windowId.length>0&&finite(w.start)&&w.start>=0&&finite(w.end)&&w.end>w.start&&w.end-w.start<=10,'Invalid fusion window');
  for(const h of [w.inputSha256,w.pipelineHash,w.rawSha256,w.pcm.sha256_16k,w.pcm.sha256_48k])check(digest(h),'Invalid window provenance hash');
  check(w.pcm.samples16k===Math.round((w.end-w.start)*16000)&&w.pcm.samples48k===Math.round((w.end-w.start)*48000),'Incomplete/unaligned fusion PCM');
  const raw=w.raw;
  check(object(raw.ast.instruments)&&equal(Object.keys(raw.ast.instruments).sort(),m.canonicalAstOrder),'Missing/extra AST scores');
  check(object(raw.jamendo)&&equal(Object.keys(raw.jamendo).sort(),JAMENDO_CLASSES),'Missing Jamendo score family; no fabricated fallback');
  for(const v of [...Object.values(raw.ast.instruments),...Object.values(raw.jamendo)])check(finite(v)&&v>=0&&v<=1,'Invalid sigmoid score');
  check(Array.isArray(raw.clap.descriptions)&&raw.clap.descriptions.length===512,'Missing CLAP score family');
  raw.clap.descriptions.forEach((d,i)=>check(finite(d.score)&&d.score>=-1&&d.score<=1&&equal(identity(d),m.clapDescriptionOrder[i]),'CLAP score/order mismatch'));
  check(w.baseline.windowId===w.windowId&&w.baseline.rawSha256===w.rawSha256&&w.baseline.rulesSha256===p.baselineRulesSha256,'Baseline/window provenance mismatch');
  check(Array.isArray(w.baseline.labels)&&new Set(w.baseline.labels).size===w.baseline.labels.length&&w.baseline.labels.every(l=>LABELS.includes(l)),'Invalid binary baseline');
}
function vector(m:Readonly<Model>,label:Label,raw:RawScores):number[]{
  const max=(xs:number[])=>xs.length?Math.max(...xs):null;
  const mapped=(scores:Record<string,number>,aliases:string[])=>max(aliases.filter(a=>Number.isFinite(scores[a])).map(a=>scores[a]));
  if(m.family==='full_scores_no_jamendo')return[...m.canonicalAstOrder.map(l=>logit(raw.ast.instruments[l])),...raw.clap.descriptions.map(d=>d.score)];
  const values=[mapped(raw.ast.instruments,m.aliases[label]),max(raw.clap.descriptions.filter(d=>d.group==='source'&&d.label!==null&&m.aliases[label].includes(d.label)).map(d=>d.score)),max(raw.clap.descriptions.filter(d=>d.group==='dj-sources'&&d.label!==null&&m.expandedClapAliases[label].includes(d.label)).map(d=>d.score))];
  return[...values.map((v,i)=>v===null?0:i===0?logit(v):v),...values.map(v=>v===null?1:0)];
}
export function scoreWindow(bound:BoundFusion,window:WindowInput):FusionWindow {
  const internal=internals.get(bound);check(internal,'Unverified fusion adapter');const{model:m,policy:p}=internal;
  validateWindow(window,m,p);
  const counts={positive:0,negative:0,uncertain:0,baselineFallback:0,total:20 as const};
  const decisions=LABELS.map(label=>{
    const h=m.heads[label],x=vector(m,label,window.raw),z=x.reduce((sum,v,i)=>sum+v*h.weights[i],h.bias);check(finite(z),'Nonfinite head logit');
    const headProbability=1/(1+Math.exp(-Math.max(-35,Math.min(35,z))));
    const fallback=p.variant==='guardedHybrid'&&!m.eligibility[label];
    const state:State=fallback?(window.baseline.labels.includes(label)?'positive':'negative'):headProbability>=p.threshold+p.margin?'positive':headProbability<=p.threshold-p.margin?'negative':'uncertain';
    counts[state]++;if(fallback)counts.baselineFallback++;
    return{label,state,headProbability,decisionProbability:fallback?null:headProbability,decisionSource:fallback?'guarded-binary-baseline' as const:'learned-head' as const,eligible:m.eligibility[label],positiveGroups:h.positiveGroups,negativeGroups:h.negativeGroups,constituentFamilies:fallback?['ast','jamendo','clap']:['ast','clap']};
  });
  return freezeDeep({kind:'openmic-fusion',scope:'window',windowId:window.windowId,start:window.start,end:window.end,labels:LABELS,decisions,counts,
    provenance:{modelFileSha256:p.modelFileSha256,modelSha256:m.modelSha256,policyFileSha256:internal.policyFileSha256,adapterSourceSha256:p.adapterSourceSha256,baselineRulesSha256:p.baselineRulesSha256,promptsSha256:p.promptsSha256,pipelineHash:window.pipelineHash,inputSha256:window.inputSha256,rawSha256:window.rawSha256},coverage:{validSeconds:window.end-window.start,samples16k:window.pcm.samples16k,samples48k:window.pcm.samples48k}});
}
