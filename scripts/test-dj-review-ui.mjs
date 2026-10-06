import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const manifest={version:1,scope:'Synthetic reviewer fixture',items:[{id:'fixture',title:'Synthetic sound.wav',folder:'Fixture',seconds:3,preview:'fixture.wav',hintReasons:[],automaticTags:[],proposedLabels:{source:[],production:[],character:[]}}]};
const catalog=JSON.parse(await readFile('src/audio/djCatalog.json','utf8'));
const state={manifest:{...manifest,items:[manifest.items[0]]},catalog,reviews:{},token:'test',pendingCategories:0,lastApplied:null};
state.reviews[manifest.items[0].id]={confirmed:true,labels:{source:['voice'],production:[],character:[]},provenance:'assistant review'};
state.manifest.items[0]={...state.manifest.items[0],instrumentCandidates:[{label:'flute',score:.12,model:'AudioSet AST'}]};
const html=await readFile('scripts/dj-review-ui/index.html','utf8');
const script=await readFile('scripts/dj-review-ui/review.js','utf8');
const dom=new JSDOM(html,{url:'http://127.0.0.1:8766'});const d=dom.window.document;
let applied=0;let saved=0;let uploaded=0;let failSave=false;let failApply=false;let failUpload=false;
const fetch=async(path,options={})=>{
 let result;
 const data=options.body&&typeof options.body==='string'?JSON.parse(options.body):null;
 if(path==='/api/state')result=state;
 else if(path==='/api/reviews'){if(failSave)return {ok:false,json:async()=>({error:'Save unavailable'})};state.reviews[data.id]=data.review;saved++;result={saved:true};}
 else if(path==='/api/categories'){const category={...data,aliases:[],family:'custom-production',axis:'dj-custom-production'};state.catalog.categories.push(category);state.pendingCategories++;result={category};}
 else if(path.startsWith('/api/sounds')){assert(path.includes('mode=song'));if(failUpload){failUpload=false;return {ok:false,json:async()=>({error:'Unreadable audio'})};}uploaded++;state.manifest.items.push({...manifest.items[0],id:'uploaded',title:'Added.wav'});result={jobId:'upload'};}
 else if(path==='/api/jobs/upload')result={state:'complete',result:{itemId:'uploaded'}};
 else if(path==='/api/apply'){assert(saved>0);applied++;state.lastApplied={trainedExamples:1,totalCategories:193};result={jobId:'apply'};}
 else if(path==='/api/jobs/apply')result=failApply?{state:'failed',message:'Build failed'}:{state:'complete',result:{trainedExamples:1,addedCategories:1}};
 else throw Error('Unexpected path '+path);
 return {ok:true,json:async()=>structuredClone(result)};
};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const trainingDataset=await new AsyncFunction('document','localStorage','fetch','Option',script+'\nreturn trainingDataset;')(d,dom.window.localStorage,fetch,dom.window.Option);
assert.equal(d.querySelectorAll('#categories input[type=checkbox]').length,catalog.categories.length,'All catalog labels are visible by default');
assert.equal(trainingDataset().examples.length,0,'Assistant guesses never enter training export');
assert(d.querySelector('#saved').textContent.includes('Assistant-reviewed'));
assert(d.querySelector('#instrument-candidates').textContent.includes('flute (AudioSet AST): 0.12'));
assert(d.querySelector('#instrument-candidates').textContent.includes('not selected automatically'));
assert(!d.querySelector('#saved').textContent.includes('confirmed by you'));
assert(d.querySelector('#progress').textContent.includes('0 of 1 clips confirmed'));
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI timed out: '+d.querySelector('#job-status').textContent);};
state.reviews[manifest.items[0].id].provenance='unverified review';
d.querySelector('#refresh-sounds').click();
await until(()=>!d.querySelector('#refresh-sounds').disabled);
assert(d.querySelector('#saved').textContent.includes('Unverified imported review'));
assert(!d.querySelector('#saved').textContent.includes('confirmed by you'));
d.querySelector('#category-name').value='test new sound';d.querySelector('#category-description').value='A short repeated synthetic pulse.';
d.querySelector('#category-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
await until(()=>!d.querySelector('#apply').disabled);
assert(state.catalog.categories.some(c=>c.label==='test new sound'));
d.querySelector('#confirm').click();await until(()=>applied===1&&!d.querySelector('#apply').disabled);
assert.equal(saved,1,'Verification saves once and automatically publishes without an Apply click');
assert(d.querySelector('#saved').textContent.includes('Verification applied'));
failSave=true;d.querySelector('#confirm').click();await until(()=>!d.querySelector('#apply').disabled);
assert.equal(applied,1,'Failed saves must not publish');
assert(d.querySelector('#saved').textContent.includes('not been applied'));
failSave=false;failApply=true;d.querySelector('#apply').click();await until(()=>applied===2&&!d.querySelector('#apply').disabled);
assert(d.querySelector('#job-status').textContent.includes('Build failed'));
failApply=false;d.querySelector('#apply').click();await until(()=>applied===3&&!d.querySelector('#apply').disabled);
assert(d.querySelector('#job-status').textContent.includes('Applied: 1'));
d.querySelector('#audio-mode').value='song';
Object.defineProperty(d.querySelector('#upload'),'files',{value:[new dom.window.File(['audio'],'Added.wav')]});
d.querySelector('#upload').dispatchEvent(new dom.window.Event('change'));
await until(()=>uploaded===1&&!d.querySelector('#apply').disabled);
assert(d.querySelector('#title').textContent==='Added.wav');
assert(d.querySelector('#progress').textContent.includes('1 of 2'));
// Imports and reviews from another tab/process become visible without losing selection.
state.manifest.items.push({...manifest.items[0],id:'external',title:'External import.wav'});
state.reviews[manifest.items[0].id]={confirmed:true,labels:{source:['breath'],production:['vocal breath'],character:[]},provenance:'explicit human confirmation'};
d.querySelector('#refresh-sounds').click();
await until(()=>!d.querySelector('#refresh-sounds').disabled);
assert.equal(d.querySelector('#picker').options.length,3);
assert.equal(d.querySelector('#title').textContent,'Added.wav');
assert(d.querySelector('#job-status').textContent.includes('3 sounds available'));
d.querySelector('#picker').value='0';d.querySelector('#picker').dispatchEvent(new dom.window.Event('change'));
assert([...d.querySelectorAll('#categories input:checked')].some(box=>box.parentElement.textContent.trim()==='breath'));
const savedBeforeRefreshApply=saved;
d.querySelector('#apply').click();await until(()=>!d.querySelector('#apply').disabled);
assert.equal(saved,savedBeforeRefreshApply,'Apply must not resend stale reviews loaded from the server');
assert.deepEqual(state.reviews[manifest.items[0].id].labels.source,['breath']);

// Explicit negatives, unknowns, drafts, and full-catalog exports stay distinct.
d.querySelector('#search').value='';d.querySelector('#search').dispatchEvent(new dom.window.Event('input'));
const statusFor=key=>[...d.querySelectorAll('#categories select')].find(select=>select.dataset.labelKey===key);
statusFor('production:kick').value='absent';statusFor('production:kick').dispatchEvent(new dom.window.Event('change'));
statusFor('production:snare').value='unsure';statusFor('production:snare').dispatchEvent(new dom.window.Event('change'));
await until(()=>state.reviews[manifest.items[0].id]?.decisions?.['production:snare']==='unsure');
assert.equal(trainingDataset().examples.length,0,'Editing a confirmation makes the clip a draft');
d.querySelector('#label-view').value='selected';d.querySelector('#label-view').dispatchEvent(new dom.window.Event('change'));
assert.equal(d.querySelectorAll('#categories input').length,2,'Selected view keeps the two positive labels');
d.querySelector('#label-view').value='all';d.querySelector('#family').value='drum-hit';d.querySelector('#family').dispatchEvent(new dom.window.Event('change'));
assert(statusFor('production:kick'),'Family filter includes drum labels');
assert([...d.querySelectorAll('#categories input:checked')].some(box=>box.parentElement.textContent.trim()==='breath'),'Selected labels remain visible across family filters');
d.querySelector('#family').value='';d.querySelector('#family').dispatchEvent(new dom.window.Event('change'));
d.querySelector('#confirm').click();await until(()=>!d.querySelector('#apply').disabled);
const dataset=trainingDataset(),example=dataset.examples.find(example=>example.id==='fixture');
assert.equal(dataset.catalog.categories.length,catalog.categories.length,'Export includes the full catalog and custom labels');
assert.deepEqual(example.absentLabels,['production:kick']);
assert.deepEqual(example.uncertainLabels,['production:snare']);
assert(!example.knownLabels.includes('production:snare'),'Unsure is never a negative');
assert(!example.knownLabels.includes('source:piano'),'An untouched label is never a negative');
assert.deepEqual(example.knownLabels.sort(),['source:breath','production:vocal breath','production:kick'].sort());
d.querySelector('#set-aside').click();await until(()=>state.reviews.fixture.reviewStatus==='uncertain');
assert.equal(trainingDataset().examples.length,0,'Set-aside clips are excluded from training');
d.querySelector('#queue').value='uncertain';d.querySelector('#queue').dispatchEvent(new dom.window.Event('change'));
assert.equal(d.querySelector('#picker').options.length,1,'Set-aside queue contains only uncertain clips');
assert.equal(d.querySelector('#title').textContent,'Synthetic sound.wav');


// Folder import skips non-audio files and continues after a bad clip.
failUpload=true;
Object.defineProperty(d.querySelector('#upload-folder'),'files',{value:[new dom.window.File(['x'],'bad.wav'),new dom.window.File(['audio'],'good.wav'),new dom.window.File(['notes'],'readme.txt')]});
d.querySelector('#upload-folder').dispatchEvent(new dom.window.Event('change'));
await until(()=>uploaded===2&&!d.querySelector('#apply').disabled);
assert(d.querySelector('#job-status').textContent.includes('1 of 2 audio files added'));
assert(d.querySelector('#job-status').textContent.includes('bad.wav: Unreadable audio'));
assert.equal(d.querySelector('#queue').value,'all');

d.querySelector('#queue').value='confirmed';d.querySelector('#queue').dispatchEvent(new dom.window.Event('change'));
assert.equal(d.querySelector('#picker').options.length,0);
assert(d.querySelector('#confirm').disabled,'Empty queues cannot confirm a hidden clip');
d.querySelector('#queue').value='all';d.querySelector('#queue').dispatchEvent(new dom.window.Event('change'));
assert(!d.querySelector('#confirm').disabled);
console.log('PASS: full catalog, scoped decisions, confirmed-only export, filters, queue safety, folder recovery, automatic learning, save/build failures, and external refresh.');dom.window.close();
