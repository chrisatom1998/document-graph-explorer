import { evaluateLabels, validateEvaluationManifest, type EvaluationItem, type EvaluationPrediction, type EvaluationSplit } from './evaluation.ts';

export interface EvaluationRevision {
  id: string;
  /** Fixed policies declared before inspecting held-out results; never synthesized here. */
  points: { id: string; predictions: EvaluationPrediction[] }[];
}
interface MatchRequest { metric: 'precision' | 'acceptedCoverage'; target: number; tolerance: number }
const pairKey=(...parts:string[])=>JSON.stringify(parts);

/** Counts annotation work and remaining known pairs, not minutes or an exhaustive label universe. */
export function reviewWorkload(raw:unknown,predictions:EvaluationPrediction[],split:EvaluationSplit) {
  const report=evaluateLabels(raw,predictions,split);
  const items=(raw as {items:EvaluationItem[]}).items.filter(i=>i.split===split);
  const ids=new Set(items.map(i=>i.id));
  const pairs=new Map<string,Set<string>>();const reviewers=new Set<string>();
  let reviewEvents=0,adjudicationEvents=0;
  for(const item of items) {
    for(const r of item.reviews) {
      reviewEvents++;reviewers.add(r.reviewer);
      const key=pairKey(item.id,r.dimension,r.label);const states=pairs.get(key)??new Set<string>();states.add(r.state);pairs.set(key,states);
    }
    for(const r of item.adjudications??[]) {
      adjudicationEvents++;reviewers.add(r.reviewer);pairs.set(pairKey(item.id,r.dimension,r.label),new Set([r.state]));
    }
  }
  for(const p of predictions)if(ids.has(p.itemId)) {
    const key=pairKey(p.itemId,p.dimension,p.label);if(!pairs.has(key))pairs.set(key,new Set());
  }
  const resolvedPairs=[...pairs.values()].filter(states=>states.size===1&&(states.has('present')||states.has('absent'))).length;
  const unresolvedPairs=pairs.size-resolvedPairs;
  return {status:(!items.length||!pairs.size?'insufficient':unresolvedPairs?'partial':'complete') as 'insufficient'|'partial'|'complete',
    items:items.length,reviewEvents,adjudicationEvents,reviewers:reviewers.size,knownPairs:pairs.size,resolvedPairs,unresolvedPairs,
    acceptedNeedingReview:report.unreviewedAccepted,
    limitation:'Counts cover declared annotations and predictions only. Omitted labels and review time are unknown; event counts do not measure reviewer effort or quality.'};
}

/** Select on calibration only; then compare frozen points on the held-out test split. */
export function compareRevisions(raw:unknown,baseline:EvaluationRevision,candidate:EvaluationRevision,match:MatchRequest) {
  const errors=validateEvaluationManifest(raw);if(errors.length)throw new Error(errors.join('; '));
  if(!match||!['precision','acceptedCoverage'].includes(match.metric)||![match.target,match.tolerance].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('Invalid match request');
  for(const revision of [baseline,candidate]) {
    if(!revision||typeof revision.id!=='string'||!revision.id.trim()||!Array.isArray(revision.points)||!revision.points.length)throw new Error('Revision and fixed points required');
    const seen=new Set<string>();
    for(const point of revision.points) {
      if(!point||typeof point.id!=='string'||!point.id.trim()||seen.has(point.id)||!Array.isArray(point.predictions))throw new Error('Invalid or duplicate point');
      seen.add(point.id);
    }
  }
  if(baseline.id===candidate.id)throw new Error('Distinct revision IDs required');
  const eligible=(revision:EvaluationRevision)=>revision.points.map(point=>({point,calibration:evaluateLabels(raw,point.predictions,'calibration')})).filter(p=>{
    const value=p.calibration.total[match.metric];
    return value!==null&&Math.abs(value-match.target)<=match.tolerance;
  });
  const baselinePoints=eligible(baseline),candidatePoints=eligible(candidate);
  const pairs=baselinePoints.flatMap(a=>candidatePoints.map(b=>({a,b}))).filter(({a,b})=>Math.abs(a.calibration.total[match.metric]!-b.calibration.total[match.metric]!)<=match.tolerance);
  const distance=(p:typeof pairs[number])=>Math.abs(p.a.calibration.total[match.metric]!-match.target)+Math.abs(p.b.calibration.total[match.metric]!-match.target);
  const lexical=(a:string,b:string)=>a<b?-1:a>b?1:0;
  pairs.sort((a,b)=>distance(a)-distance(b)||lexical(a.a.point.id,b.a.point.id)||lexical(a.b.point.id,b.b.point.id));
  const selected=pairs[0];
  const describe=(revision:EvaluationRevision,p:typeof selected.a)=>({revisionId:revision.id,pointId:p.point.id,calibration:p.calibration,test:evaluateLabels(raw,p.point.predictions,'test'),
    calibrationWorkload:reviewWorkload(raw,p.point.predictions,'calibration'),testWorkload:reviewWorkload(raw,p.point.predictions,'test')});
  const a=selected?describe(baseline,selected.a):null;const b=selected?describe(candidate,selected.b):null;
  const subtract=(x:number|null,y:number|null)=>x===null||y===null?null:y-x;
  const delta=a&&b?{precision:subtract(a.test.total.precision,b.test.total.precision),recall:subtract(a.test.total.recall,b.test.total.recall),acceptedCoverage:subtract(a.test.total.acceptedCoverage,b.test.total.acceptedCoverage),
    unresolvedPairs:b.testWorkload.unresolvedPairs-a.testWorkload.unresolvedPairs,acceptedNeedingReview:b.testWorkload.acceptedNeedingReview-a.testWorkload.acceptedNeedingReview}:null;
  const reasons:string[]=[];
  let status:'insufficient'|'partial'|'complete'='complete';
  if(!a||!b){status='insufficient';reasons.push('No calibration point pair meets the declared target and pairwise tolerance.');}
  else if([a,b].some(p=>p.test.total.precision===null||p.test.total.recall===null||p.test.total.acceptedCoverage===null)) {
    status='insufficient';reasons.push('Held-out precision, recall or coverage has no denominator.');
  } else if([a,b].some(p=>p.calibrationWorkload.status!=='complete'||p.testWorkload.status!=='complete'||p.test.itemAnnotationCoverage!==1||p.calibration.itemAnnotationCoverage!==1)) {
    status='partial';reasons.push('Some items or declared label opportunities lack resolved annotations.');
  }
  return {status,reasons,match,baseline:a,candidate:b,delta,
    limitation:'Matching uses calibration only, with absolute tolerance and lexical point-ID ties. Held-out precision/coverage may differ. Complete means available denominators and resolved known pairs, not exhaustive annotation, statistical sufficiency, calibration certification or a quality gain.'};
}
