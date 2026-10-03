// Research export decoder. No network, labels, or app promotion.
import {descriptorIdentity} from './descriptor-contract.mjs';
export function vector(model, label, raw) {
 const max=(values)=>values.length?Math.max(...values):null;
 const mapped=(scores,names)=>max(names.filter(n=>Number.isFinite(scores[n])).map(n=>scores[n]));
 const logit=p=>{p=Math.max(1e-6,Math.min(1-1e-6,p));return Math.log(p/(1-p));};
 const fields={ast:mapped(raw.ast.instruments,model.aliases[label]),jamendo:mapped(raw.jamendo,model.jamendoAliases[label]),
  clapLegacy:max(raw.clap.descriptions.filter(d=>d.group==='source'&&model.aliases[label].includes(d.label)).map(d=>d.score)),
  clapExpanded:max(raw.clap.descriptions.filter(d=>d.group==='dj-sources'&&model.expandedClapAliases[label].includes(d.label)).map(d=>d.score))};
 const needsEmbedding=model.heads[label].featureNames.some(n=>n.startsWith('clap:'));
 const norm=needsEmbedding?Math.hypot(...raw.clap.embedding):1;
 if(!Number.isFinite(norm)||norm<=0||(needsEmbedding&&raw.clap.embedding.length!==512))throw Error('Invalid embedding');
 const result=model.heads[label].featureNames.map(name=>{
  if(name.startsWith('clap:'))return raw.clap.embedding[Number(name.slice(5))]/norm;
  if(name.startsWith('clapScore:')){
   const index=Number(name.slice(10)),d=raw.clap.descriptions[index],order=model.clapDescriptionOrder[index];
   if(!Number.isInteger(index)||!d||!order||JSON.stringify(descriptorIdentity(d))!==JSON.stringify(order)||!Number.isFinite(d.score))throw Error('Invalid ordered CLAP score');
   return d.score;
  }
  if(name.startsWith('astLogit:'))return logit(raw.ast.instruments[name.slice(9)]);
  if(name.endsWith('Missing'))return fields[name.slice(0,-7)]===null?1:0;
  if(!(name in fields))throw Error('Unknown feature');
  const value=fields[name];return value===null?0:['ast','jamendo'].includes(name)?logit(value):value;
 });
 if(result.some(v=>!Number.isFinite(v)))throw Error('Invalid feature');return result;
}
export function probability(model,label,raw){
 const x=vector(model,label,raw),h=model.heads[label];
 if(x.length!==h.weights.length)throw Error('Invalid head width');
 const z=x.reduce((sum,v,i)=>sum+v*h.weights[i],h.bias);
 if(!Number.isFinite(z))throw Error('Invalid head logit');
 return 1/(1+Math.exp(-Math.max(-35,Math.min(35,z))));
}
