// Isolated actual-app callback bridge. No data reads, fitting or feature enablement.
import {bindFrozenArtifacts,JAMENDO_CLASSES,LABELS,sha256} from './adapter.ts';
import {probability} from './browser-head-scorer.mjs';
import {deriveBaseline} from './baselineProducer.ts';
import {createRecognition,modelCacheKey} from '../recognition';
const check=(v,m)=>{if(!v)throw Error(m);};
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=d=>[d.group,d.label,d.alternative??null,d.learnedGroup??null,d.decision??null];
const deepFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;};
/** Caller verifies the served bridge/dependency bytes against the final freeze.
 * bindFrozenArtifacts validates exactly the same model/policy/prompt bytes as
 * capture replay. Native caches carry model/window keys, not fabricated PCM hashes.
 */
export async function createNativeFusionScorer(artifacts,{bridgeSourceBytes,expectedBridgeSourceSha256,scorerSourceBytes,expectedScorerSourceSha256}){
 artifacts={...artifacts,modelBytes:new Uint8Array(artifacts.modelBytes),policyBytes:new Uint8Array(artifacts.policyBytes),adapterSourceBytes:new Uint8Array(artifacts.adapterSourceBytes),baselineRulesBytes:new Uint8Array(artifacts.baselineRulesBytes),promptsBytes:new Uint8Array(artifacts.promptsBytes)};
 bridgeSourceBytes=new Uint8Array(bridgeSourceBytes);scorerSourceBytes=new Uint8Array(scorerSourceBytes);
 check(digest(expectedBridgeSourceSha256)&&digest(expectedScorerSourceSha256),'Missing bridge/scorer source binding');
 check(await sha256(bridgeSourceBytes)===expectedBridgeSourceSha256&&await sha256(scorerSourceBytes)===expectedScorerSourceSha256,'Bridge/scorer source changed');
 const bound=await bindFrozenArtifacts(artifacts),text=new TextDecoder();
 const model=deepFreeze(JSON.parse(text.decode(artifacts.modelBytes))),policy=deepFreeze(JSON.parse(text.decode(artifacts.policyBytes)));
 check(policy.selectionEvidence?.reviewedScorerSha256===expectedScorerSourceSha256,'Selected policy does not bind current reviewed scorer');
 check(policy.inputSupport?.rule==='app-mse-v1'&&policy.inputSupport.threshold===1e-8&&policy.inputSupport.comparison==='>'&&policy.inputSupport.minimumSeconds===2.048&&policy.inputSupport.onMissingSilentOrShort==='unsupported-no-decisions','Unexpected app support policy');
 const expectedJobs=createRecognition(10,'full').jobs.filter(j=>['ast','jamendo','clap'].includes(j.modelId));
 return Object.freeze({identity:Object.freeze({modelSha256:model.modelSha256,policySha256:bound.policyFileSha256,scorerSha256:expectedBridgeSourceSha256}),
 async score(input,signal){
  signal?.throwIfAborted();
  check(input&&digest(input.audioFingerprint)&&input.interval&&Number.isFinite(input.interval.start)&&Number.isFinite(input.interval.end)&&input.interval.start>=0&&input.interval.end<=86400&&input.interval.end-input.interval.start>=2.048&&input.interval.end-input.interval.start<=10.000001,'Invalid native window');
  check(Array.isArray(input.native)&&input.native.length===3,'Missing native jobs');
  for(const expected of expectedJobs){const actual=input.native.find(j=>j.modelId===expected.modelId);check(actual&&typeof actual.cacheHit==='boolean'&&actual.weightsVersion===expected.weightsVersion&&actual.preprocessingVersion===expected.preprocessingVersion&&(actual.promptVersion??'')===(expected.promptVersion??'')&&actual.cacheKey===modelCacheKey(input.audioFingerprint,expected,input.interval),'Native model/window/cache binding mismatch');}
  const raw=input.raw;check(raw&&raw.ast&&raw.jamendo&&raw.clap,'Missing raw families');
  check(same(Object.keys(raw.ast.instruments).sort(),model.canonicalAstOrder)&&same(Object.keys(raw.jamendo).sort(),JAMENDO_CLASSES),'Raw score schema mismatch');
  check([...Object.values(raw.ast.instruments),...Object.values(raw.jamendo)].every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Invalid native sigmoid score');
  check(Array.isArray(raw.clap.descriptions)&&raw.clap.descriptions.length===512&&raw.clap.descriptions.every((d,i)=>Number.isFinite(d.score)&&d.score>=-1&&d.score<=1&&same(identity(d),model.clapDescriptionOrder[i])),'Invalid ordered native CLAP scores');
  const baseline=deriveBaseline(raw,model.aliases);
  return LABELS.map(label=>{const head=model.heads[label],p=probability(model,label,raw),fallback=policy.variant==='guardedHybrid'&&!model.eligibility[label];
   const state=fallback?(baseline.includes(label)?'positive':'negative'):p>=policy.threshold+policy.margin?'positive':p<=policy.threshold-policy.margin?'negative':'uncertain';
   return{label,state,headProbability:p,decisionProbability:fallback?null:p,source:fallback?'guarded-binary-baseline':'learned-head',eligible:model.eligibility[label],positiveGroups:head.positiveGroups,negativeGroups:head.negativeGroups};
  });
 }});
}
