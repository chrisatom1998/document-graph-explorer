import { expect, it } from 'vitest';
import { compareRevisions, reviewWorkload, type EvaluationRevision } from './evaluationComparison';
import type { EvaluationItem } from './evaluation';
const item=(id:string,split:'calibration'|'test'):EvaluationItem=>({id,split,tier:'loop',source:'local:'+id,rights:{evaluationAllowed:true,basis:'fixture'},groups:{original:id,artist:id,pack:id,sampleFamily:id},transformations:[],start:0,end:1,reviews:[{reviewer:'a',at:'2026-10-03T00:00:00Z',dimension:'source',label:'piano',state:'present'}]});
const manifest={version:1,frozenAt:'2026-10-03T00:00:00Z',items:[item('c','calibration'),item('t','test')]};
const accepted=(itemId:string)=>({itemId,dimension:'source',label:'piano',decision:'accepted' as const});
const revision=(id:string):EvaluationRevision=>({id,points:[{id:'fixed',predictions:[accepted('c'),accepted('t')]}]});
it('selects deterministically on calibration and reports held-out deltas without claiming test matching',()=>{
 const a=revision('a');a.points.unshift({id:'z',predictions:[accepted('c')]});
 const r=compareRevisions(manifest,a,revision('b'),{metric:'precision',target:1,tolerance:0});
 expect(r.status).toBe('complete');expect(r.baseline?.pointId).toBe('fixed');expect(r.delta?.recall).toBe(0);
 expect(compareRevisions(manifest,{...a,points:[...a.points].reverse()},revision('b'),{metric:'precision',target:1,tolerance:0})).toEqual(r);
});
it('reports insufficient data for empty calibration, unavailable targets or absent held-out denominators',()=>{
 expect(compareRevisions({...manifest,items:[item('t','test')]},{id:'a',points:[{id:'p',predictions:[accepted('t')]}]},{id:'b',points:[{id:'p',predictions:[accepted('t')]}]},{metric:'precision',target:1,tolerance:0}).status).toBe('insufficient');
 expect(compareRevisions(manifest,revision('a'),revision('b'),{metric:'acceptedCoverage',target:.5,tolerance:0}).status).toBe('insufficient');
 const r=revision('a');r.points[0].predictions=[accepted('c')];
 expect(compareRevisions(manifest,r,revision('b'),{metric:'precision',target:1,tolerance:0}).status).toBe('insufficient');
});
it('marks partial annotations and counts review workload without turning missing labels into negatives',()=>{
 const m=structuredClone(manifest);m.items[1].reviews.push({...m.items[1].reviews[0],reviewer:'b',state:'uncertain'});
 const w=reviewWorkload(m,[accepted('t'),accepted('t')],'test');
 expect(w).toMatchObject({reviewEvents:2,reviewers:2,knownPairs:1,resolvedPairs:0,unresolvedPairs:1,acceptedNeedingReview:1,status:'partial'});
 const a=revision('a');a.points[0].predictions.push({...accepted('t'),label:'drums'});
 expect(compareRevisions(manifest,a,revision('b'),{metric:'acceptedCoverage',target:1,tolerance:0}).status).toBe('partial');
});
it('rejects malformed configuration and duplicate point identifiers',()=>{
 expect(()=>compareRevisions(manifest,revision('a'),revision('b'),{metric:'precision',target:NaN,tolerance:0})).toThrow();
 const a=revision('a');a.points.push(a.points[0]);expect(()=>compareRevisions(manifest,a,revision('b'),{metric:'precision',target:1,tolerance:0})).toThrow();
});
it('matches coverage on calibration without using better held-out results to choose policies',()=>{
 const m=structuredClone(manifest);m.items.push(item('c2','calibration'));
 const a=revision('a');a.points=[{id:'a',predictions:[accepted('c')]},{id:'z',predictions:[accepted('c'),accepted('t')]}];
 const b=revision('b');
 const r=compareRevisions(m,a,b,{metric:'acceptedCoverage',target:.5,tolerance:0});
 expect(r.baseline?.pointId).toBe('a');expect(r.baseline?.calibration.total.acceptedCoverage).toBe(.5);
 expect(r.delta?.recall).toBe(1);expect(r.status).toBe('insufficient');
});
it('requires pairwise matching, not just each point falling near the target',()=>{
 const m=structuredClone(manifest);m.items.push(item('c2','calibration'),item('c3','calibration'),item('c4','calibration'));
 const a=revision('a'),b=revision('b');b.points[0].predictions.push(accepted('c2'),accepted('c3'));
 expect(compareRevisions(m,a,b,{metric:'acceptedCoverage',target:.5,tolerance:.25}).status).toBe('insufficient');
});
it('keeps adjudicated history workload and treats unknown predictions as unresolved work',()=>{
 const m=structuredClone(manifest);const t=m.items[1];t.reviews.push({...t.reviews[0],reviewer:'b',state:'absent'});
 t.adjudications=[{...t.reviews[0],state:'present',reason:'fixture adjudication'}];
 expect(reviewWorkload(m,[accepted('t')],'test')).toMatchObject({status:'complete',reviewEvents:2,adjudicationEvents:1,resolvedPairs:1,unresolvedPairs:0});
 expect(reviewWorkload(m,[{...accepted('t'),label:'drums',decision:'unknown'}],'test')).toMatchObject({status:'partial',knownPairs:2,unresolvedPairs:1,acceptedNeedingReview:0});
});
