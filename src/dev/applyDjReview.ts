/** Local review service's transactional model publisher. */
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sanitizeLearnedDjModel, type LearnedDjModel } from '../audio/learnedDjModel';
import { trainReviewedClassifier } from './trainReviewedClassifier';
import { humanTrainingReviews, HUMAN_REVIEW_PROVENANCE } from './djReviewProvenance';
import { withReviewFileTransaction } from './reviewFileTransaction';
interface Category { group:string; label:string; description:string; family:string; source:string|null; aliases:string[]; recognition:string; axis:string }
interface Request {
  reviews: Record<string,{confirmed:boolean; provenance?:unknown; labels:{source:string[]; production:string[]; character:string[]}; knownLabels:string[]}>;
  items: {id:string; embedding:number[]; title?:string; songId?:string}[];
  categories: Category[];
}
const requestPath = process.argv.find(v=>v.endsWith('/request.json'));
if (!requestPath) throw new Error('Expected an absolute request.json path.');
const directory=dirname(resolve(requestPath));
const request=JSON.parse(await readFile(requestPath,'utf8')) as Request;
const catalogPath='src/audio/djCatalog.json';
const catalog=JSON.parse(await readFile(catalogPath,'utf8')) as {version:number;categories:Category[]};
const manifestPath='public/sound-model/manifest.json';
const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {repository:string;revision:string;catalogVersion?:number;sha256:Record<string,string>};
const additions=request.categories.filter(c=>!catalog.categories.some(existing=>existing.group===c.group&&existing.label===c.label));
const categories=[...catalog.categories,...additions];
const known=new Set(categories.map(c=>`${c.group}:${c.label}`));
const examples=humanTrainingReviews(request.reviews).map(([id,review])=>{
  const item=request.items.find(i=>i.id===id);
  if (!item) throw new Error('Review references a missing sound.');
  if (review.provenance !== HUMAN_REVIEW_PROVENANCE) throw new Error('Only explicit human confirmations can train the classifier.');
  for (const group of ['source','production','character'] as const) {
    if (!Array.isArray(review.labels[group]) || review.labels[group].some(label=>!known.has(`${group}:${label}`))) throw new Error('Unknown training label.');
  }
  if (!Array.isArray(review.knownLabels) || review.knownLabels.some(key=>!known.has(key))) throw new Error('Invalid category snapshot.');
  return {id,vector:item.embedding,labels:review.labels,knownLabels:review.knownLabels,provenance:review.provenance};
});
const encoder=`${manifest.repository}@${manifest.revision}`;
const revision=createHash('sha256').update(JSON.stringify({encoder,examples,categories})).digest('hex').slice(0,16);
const model=sanitizeLearnedDjModel({version:1,encoder,revision,examples});
if (!model) throw new Error('Reviewed audio features are invalid.');
const families=Object.fromEntries(request.items.map(i=>[i.id,i.songId ?? (i.title ?? i.id).toLowerCase().replace(/\.[^.]+$/,'').replace(/\d+/g,'').replace(/[ _-]+/g,' ').trim()]));
const trained=trainReviewedClassifier(model.examples,families);
model.heads=trained.heads;
model.revision=createHash('sha256').update(JSON.stringify({revision,heads:model.heads})).digest('hex').slice(0,16);
await writeFile(join(directory,'classifier-report.json'),JSON.stringify(trained.report,null,2)+'\n');
const promptsPath='public/sound-model/prompts.json';
const prompts=JSON.parse(await readFile(promptsPath,'utf8')) as {group:string;label:string|null;prompt:string;vector:number[]}[];
if (additions.length) {
  const {env,AutoTokenizer,ClapTextModelWithProjection}=await import('@huggingface/transformers');
  // Custom categories need the frozen text encoder, which the browser does
  // not bundle. Download its pinned public revision once and cache it locally.
  // Reviewed audio and labels are never sent to the model host.
  env.allowRemoteModels=true;
  const options={revision:manifest.revision,cache_dir:'./artifacts/music-evaluation/clap-text-cache'};
  const tokenizer=await AutoTokenizer.from_pretrained(manifest.repository,options);
  const textModel=await ClapTextModelWithProjection.from_pretrained(manifest.repository,{...options,dtype:'q8'});
  try {
    for (const category of additions) {
      const output=await textModel(tokenizer(category.description,{padding:true,truncation:true}));
      const vector=Array.from(output.text_embeds.data) as number[];
      if(vector.length!==512 || !vector.every(Number.isFinite)) throw new Error('Failed to encode a category.');
      prompts.push({group:category.axis,label:category.label,prompt:category.description,vector});
    }
    for(const axis of new Set(additions.map(c=>c.axis))) {
      if (prompts.some(p=>p.group===axis&&p.label===null)) continue;
      // Reuse audio-independent text vectors for competing sounds and silence.
      const alternatives=prompts.filter(p=>p.group==='dj-type');
      for(const alternative of alternatives) prompts.push({...alternative,group:axis,label:null});
      const silence=prompts.find(p=>p.group==='source'&&p.label===null);
      if(silence)prompts.push({...silence,group:axis});
    }
  } finally { await textModel.dispose(); }
}
const oldRevisionSource=await readFile('src/audio/musicTypes.ts','utf8');
const nextRevisionSource=oldRevisionSource.replace(/INSTRUMENT_ANALYSIS_REVISION = (\d+)/,(_,value:string)=>`INSTRUMENT_ANALYSIS_REVISION = ${Number(value)+1}`);
if(nextRevisionSource===oldRevisionSource)throw new Error('Could not update the audio analysis revision.');
const catalogVersion=catalog.version+(additions.length?1:0);
const modelText=JSON.stringify(model)+'\n'; const promptsText=JSON.stringify(prompts);
manifest.catalogVersion=catalogVersion;
manifest.sha256['prompts.json']=createHash('sha256').update(promptsText).digest('hex');
manifest.sha256['learned.json']=createHash('sha256').update(modelText).digest('hex');
const writes=new Map([
  [catalogPath,JSON.stringify({...catalog,version:catalogVersion,categories},null,2)+'\n'],
  [promptsPath,promptsText],
  ['scripts/sound-profile-prompts.json',JSON.stringify(prompts.map(p=>({group:p.group,label:p.label,prompt:p.prompt})),null,2)+'\n'],
  ['public/sound-model/learned.json',modelText],
  [manifestPath,JSON.stringify(manifest,null,2)+'\n'],
  ['src/audio/musicTypes.ts',nextRevisionSource],
]);
const staging=join(directory,'web-build');
let movedPrevious=false;
await withReviewFileTransaction(writes, join(directory,'backup'), async () => {
  execFileSync('npm',['run','typecheck'],{stdio:'inherit'});
  execFileSync('npx',['vite','build','--outDir',staging],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
  execFileSync('node',['scripts/verify-runtime-assets.mjs',staging],{stdio:'inherit'});
  execFileSync('node',['scripts/check-bundle.mjs',staging],{stdio:'inherit'});
  let exists=true;try{await access('dist');}catch{exists=false;}
  if(exists){await rename('dist',join(directory,'previous-web-build'));movedPrevious=true;}
  try {await rename(staging,'dist');}catch(error){if(movedPrevious)await rename(join(directory,'previous-web-build'),'dist');throw error;}
  const result={revision:model.revision,classifier:trained.report,trainedExamples:model.examples.length,addedCategories:additions.length,totalCategories:categories.length,updatedAt:new Date().toISOString(),method:'Supervised classifiers and nearest reviewed examples over frozen CLAP audio features',validation:'Build and asset checks passed. Classifier test results are provisional; improvement over the base model has not been measured.',next:'Reload the local Document Graph Explorer web app and reanalyze audio. Packaged desktop copies require a separate rebuild.'};
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
});
// This script is also type-checked as part of the app project.
export type PublishedDjModel = LearnedDjModel;
