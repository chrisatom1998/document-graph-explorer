// Score frozen OpenMIC labels against local harness outputs; never changes predictions.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluateLabels } from '../src/audio/evaluation.ts';
const [selectionPath, manifestPath, rawPath, split] = process.argv.slice(2);
if(!selectionPath || !manifestPath || !rawPath || !['train','calibration','test'].includes(split))throw Error('Usage: node scripts/score-openmic-pilot.mjs selection.json manifest.json raw.json train|calibration|test');
const texts=await Promise.all([selectionPath,manifestPath,rawPath].map(p=>readFile(p,'utf8')));
const [selection,manifest,raw]=texts.map(t=>JSON.parse(t));
const expected=selection.items.filter(i=>i.split===split);
if(raw.cases.length!==expected.length || new Set(raw.cases.map(c=>c.id)).size!==expected.length)throw Error('Every frozen split item must have exactly one runtime result');
for(const item of expected){const run=raw.cases.find(c=>c.id===item.id);if(!run||run.sha256!==item.audio.sha256)throw Error('Frozen audio hash mismatch');}
if(raw.remoteBlocked.length)throw Error('Unexpected remote request during local benchmark');
const mapLabels=labels=>Object.entries(selection.runtimeLabelMapping).filter(([,aliases])=>labels.some(label=>aliases.includes(label))).map(([label])=>label);
const policies={};
for(const policy of ['sourceCandidates','primarySource','acceptedSources']){
 const predictions=raw.cases.flatMap(c=>{
  const observations=c.output?.recognition?.observations??[];
  const labels=policy==='primarySource'?(c.output?.soundProfile?.source?[c.output.soundProfile.source.label]:[]):observations.filter(o=>o.dimension==='source'&&(policy!=='acceptedSources'||o.status==='accepted')).map(o=>o.labelId);
  return mapLabels(labels).map(label=>({itemId:c.id,dimension:'instrument',label,decision:'accepted'}));
 });
 policies[policy]={description:selection.decisionPolicies[policy],...evaluateLabels(manifest,predictions,split)};
}
console.log(JSON.stringify({split,selectionSha256:selection.selectionSha256,manifestSha256:createHash('sha256').update(texts[1]).digest('hex'),rawSha256:createHash('sha256').update(texts[2]).digest('hex'),browser:raw.browser,modelManifests:raw.modelManifests,completed:raw.cases.filter(c=>c.output?.recognition?.status==='complete').length,failures:raw.cases.filter(c=>c.error).map(c=>({id:c.id,error:c.error})),pageErrors:raw.errors,seconds:raw.cases.reduce((n,c)=>n+c.ms,0)/1000,policies},null,2));
