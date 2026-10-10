import { expect, it } from 'vitest';
import { DjTagEvidence, sanitizeConfirmedDjTags, sanitizeDjTags, selectDjTags } from './djTags';
import { combineSoundModels } from './ensemble';
import { DescriptionAccumulator } from './profileDescriptions';
import { sanitizeMusicAnalysis } from './musicTypes';
const complete={ast:true,jamendo:true,clap:true};
it('compares production and character independently while rejecting confusing alternatives',()=>{
 const tags=selectDjTags([{group:'breath',label:'vocal breath',score:.6},{group:'breath',label:'noise',score:.4},{group:'dj-tone',label:'dark',score:.5},{group:'dj-tone',label:'bright',score:.2}]);
 expect(tags.map(t=>t.label)).toEqual(['vocal breath','dark']);
 for(const scores of [[.3,.1],[.6,.59],[.5,.7]])expect(selectDjTags([{group:'breath',label:'vocal breath',score:scores[0]},{group:'breath',label:'noise',score:scores[1]}])).toEqual([]);
});
it('recognizes breath from the audio models and retains attribution',()=>{
 const result=combineSoundModels([{label:'breath',score:.92,status:'likely'}],{synthesizer:.4},[],complete);
 expect(result.source?.label).toBe('breath');
 expect(result.djTags).toContainEqual({group:'production',label:'vocal breath',score:.92,model:'AudioSet AST'});
 expect(sanitizeMusicAnalysis({version:2,durationSeconds:2,analyzedSeconds:2,instruments:[],notes:[],soundProfile:result})?.soundProfile).toEqual(result);
});
it('does not replace a strong acoustic instrument with a synthetic production description',()=>{
 const result=combineSoundModels([{label:'piano',score:.95,status:'likely'}],{},[{group:'dj-type',label:'synth pluck',score:.6}],complete);
 expect(result.source?.label).toBe('piano');
 expect(result.djTags?.some(t=>t.label==='synth pluck')).toBe(false);
});
it('preserves a brief accepted sound and bounds its timing examples',()=>{
 const evidence=new DjTagEvidence();const tag={group:'production' as const,label:'vocal breath',score:.7};
 evidence.add([tag],5,15);for(let i=0;i<20;i++)evidence.add([tag],20+i*5,30+i*5);
 expect(evidence.results()[0].segments).toHaveLength(3);
 expect(evidence.results()[0].segments?.[0]).toEqual({start:5,end:15});
 const mean=new DescriptionAccumulator();mean.add([{group:'breath',label:'vocal breath',score:.7}]);mean.add([]);
 expect(mean.average()[0].score).toBe(.35);
});
it('validates annotations and tag evidence without accepting arbitrary labels or times',()=>{
 expect(sanitizeConfirmedDjTags({source:['breath','made up'],production:['vocal breath','vocal breath'],character:['airy']})).toEqual({source:['breath'],production:[],character:['airy']});
 expect(sanitizeConfirmedDjTags({source:['noise'],production:['synth stab','synth hit'],character:[]})).toEqual({source:[],production:['static noise','synth hit'],character:[]});
 expect(sanitizeConfirmedDjTags({source:[],production:['downlifter'],character:['falling']})).toEqual({source:[],production:[],character:['falling']});
 expect(sanitizeConfirmedDjTags({source:['turntable'],production:['vinyl scratch'],character:[]})).toEqual({source:[],production:['vinyl scratch'],character:[]});
 expect(sanitizeConfirmedDjTags({source:[],production:['harmony vocals','choir'],character:[]})).toEqual({source:[],production:['choir'],character:[]});
 expect(sanitizeConfirmedDjTags({source:[],production:['303 bass','acid synth'],character:[]})).toEqual({source:[],production:['acid synth'],character:[]});
 expect(sanitizeConfirmedDjTags({source:'breath'})).toBeUndefined();
 expect(sanitizeDjTags([{group:'__proto__',label:'x',score:.9},{group:'production',label:'vocal breath',score:.7,segments:[{start:-1,end:4},{start:0,end:2}]}])).toEqual([{group:'production',label:'vocal breath',score:.7,segments:[{start:0,end:2}]}]);
});
it('does not bypass the breath-versus-noise comparison through the production axis',()=>{
 const scores=[{group:'dj-type' as const,label:'vocal breath',score:.6},{group:'breath' as const,label:'vocal breath',score:.6},{group:'breath' as const,label:'noise',score:.7}];
 expect(selectDjTags(scores)).toEqual([]);
});
it('lets a tested passage tag replace an untested one and stand for its source', async () => {
 const { mergeDjTags } = await import('./djClassification');
 const profile = combineSoundModels([{ label: 'drum kit', score: .97, status: 'likely' }], {}, [], { ast: true, jamendo: true, clap: true });
 mergeDjTags(profile, [{ group: 'production', label: 'snare', score: .7, model: 'Trained head' }]);
 expect(profile.djTags).toContainEqual({ group: 'source', label: 'drums', score: .7, model: 'Trained head' });
 // A maybe head never replaces a full tested tag.
 mergeDjTags(profile, [{ group: 'production', label: 'snare', score: .99, model: 'Trained head (maybe)' }]);
 expect(profile.djTags).toContainEqual(expect.objectContaining({ label: 'snare', model: 'Trained head', score: .7 }));
});
