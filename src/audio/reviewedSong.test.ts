import {it,expect} from 'vitest';
import {DescriptionAccumulator,type DescriptionScore} from './profileDescriptions';
import {combineSoundModels} from './ensemble';
import {mergeDjTags} from './djClassification';
const learned=(label:string,decision:'include'|'exclude',score=1):DescriptionScore=>({group:'dj-learned',learnedGroup:'source',label,decision,score});
it('retains different learned instruments across a song and rejects a bad synth tag',()=>{
 const a=new DescriptionAccumulator();a.add([learned('piano','include'),learned('synthesizer','exclude')]);a.add([learned('saxophone','include')]);for(let i=0;i<20;i++)a.add([]);
 const scores=a.average();expect(scores.filter(s=>s.decision==='include').map(s=>s.label)).toEqual(['piano','saxophone']);
 const p=combineSoundModels([],{synthesizer:.8},scores,{ast:true,jamendo:true,clap:true});
 mergeDjTags(p,[{group:'source',label:'synthesizer',score:.9,model:'Music CLAP'}],scores);
 expect(p.source?.basis).toBe('Reviewed examples');expect(p.djTags?.filter(t=>t.group==='source').map(t=>t.label)).toEqual(['piano','saxophone']);
});
it('does not let a negative section erase equally strong positive evidence elsewhere',()=>{
 const a=new DescriptionAccumulator();a.add([learned('synthesizer','include')]);a.add([learned('synthesizer','exclude')]);expect(a.average()).toEqual([]);
});
