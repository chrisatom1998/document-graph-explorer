// Compare a held-out collection export's automatic DJ tags with reviewed labels.
import {readFile} from 'node:fs/promises';
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/evaluate-dj-tags.mjs <collection-export.json>');
const data=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(data.nodes))throw new Error('Expected a collection export with nodes.');
const catalog=JSON.parse(await readFile(new URL('../src/audio/djCatalog.json',import.meta.url),'utf8'));
const report={reviewedTracks:0,groups:{},categories:catalog.categories.map(c=>({group:c.group,label:c.label,examples:0,correct:0,extra:0,missed:0,recognition:c.recognition})),mistakes:[]};
for(const group of ['source','production','character'])report.groups[group]={correct:0,extra:0,missed:0};
for(const node of data.nodes){
 const truth=node.audio?.confirmedDjTags;if(!truth)continue;report.reviewedTracks++;
 for(const group of Object.keys(report.groups)){
  const expected=new Set(truth[group]??[]),actual=new Set((node.audio.soundProfile?.djTags??[]).filter(t=>t.group===group).map(t=>t.label));
  for(const category of report.categories.filter(c=>c.group===group)){
    if(expected.has(category.label))category.examples++;
    if(expected.has(category.label)&&actual.has(category.label))category.correct++;
    if(!expected.has(category.label)&&actual.has(category.label))category.extra++;
    if(expected.has(category.label)&&!actual.has(category.label))category.missed++;
  }
  const extra=[...actual].filter(v=>!expected.has(v)),missed=[...expected].filter(v=>!actual.has(v));
  report.groups[group].correct += [...actual].filter(v=>expected.has(v)).length;
  report.groups[group].extra += extra.length;report.groups[group].missed += missed.length;
  if(extra.length||missed.length)report.mistakes.push({track:node.title,group,extra,missed});
 }
}
for(const counts of Object.values(report.groups)){
 counts.precision=counts.correct+counts.extra?counts.correct/(counts.correct+counts.extra):null;
 counts.recall=counts.correct+counts.missed?counts.correct/(counts.correct+counts.missed):null;
}
for(const c of report.categories){
 c.precision=c.correct+c.extra?c.correct/(c.correct+c.extra):null;
 c.recall=c.examples?c.correct/c.examples:null;
 c.validation=c.examples===0?'no labeled examples':c.examples<20?'insufficient examples':'needs independent held-out review';
}
report.coverage={total:report.categories.length,withExamples:report.categories.filter(c=>c.examples>0).length,withoutExamples:report.categories.filter(c=>c.examples===0).map(c=>c.label)};
console.log(JSON.stringify(report,null,2));
