/* global document, fetch, localStorage, structuredClone, URL, Blob, setTimeout, Option */
const el=id=>document.getElementById(id);
let server=await (await fetch('/api/state',{cache:'no-store'})).json();
let {manifest,catalog}=server;
const key='dge-shadow-uk1-review-first10-v1';
let local={};try{local=JSON.parse(localStorage.getItem(key)||'{}');}catch{local={};}
let reviews={...local,...server.reviews};
let busy=false;
let saveQueue=Promise.resolve();
const pendingReviewIds=new Set();
const knownLabels=()=>catalog.categories.map(c=>c.group+':'+c.label);
const humanConfirmation=review=>review?.confirmed===true&&review.provenance==='explicit human confirmation';
async function post(path,data,raw=false){
 const response=await fetch(path,{method:'POST',headers:{'X-Review-Token':server.token,...(raw?{}:{'Content-Type':'application/json'})},body:raw?data:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save changes.');return result;
}
async function saveReview(id){
 const review=reviews[id];if(!review)return;
 if(!review.knownLabels)review.knownLabels=knownLabels();
 const payload={...review};
 await post('/api/reviews',{id,review:payload});
 if(JSON.stringify(reviews[id])===JSON.stringify(payload))pendingReviewIds.delete(id);
}
function saveLocal(){try{localStorage.setItem(key,JSON.stringify(reviews));}catch{ /* Server copy remains available. */ }}
function persist(){
 const id=manifest.items[current].id;pendingReviewIds.add(id);saveLocal();updateProgress();
 saveQueue=saveQueue.then(()=>saveReview(id)).then(()=>{el('saved').textContent='Saved on this computer.';}).catch(error=>{el('saved').textContent=error.message+' Your browser copy is retained.';});
}
const groups=['source','production','character'];let current=0;
const labelsFor=item=>reviews[item.id]?.labels||structuredClone(item.proposedLabels);
function updateProgress(){el('progress').textContent=`${manifest.items.filter(i=>humanConfirmation(reviews[i.id])).length} of ${manifest.items.length} clips confirmed · ${catalog.categories.length} available categories`;}
function renderCategories(){
 const item=manifest.items[current];if(!item)return;const labels=labelsFor(item),query=el('search').value.trim().toLowerCase();el('categories').replaceChildren();
 for(const group of groups){const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=group==='production'?'Production type':group[0].toUpperCase()+group.slice(1);field.append(legend);const choices=document.createElement('div');choices.className='choices';
 for(const c of catalog.categories.filter(c=>c.group===group&&(labels[group].includes(c.label)||(query ? [c.label,c.family,...c.aliases].some(s=>s.includes(query)) : item.automaticTags.some(t=>t.group===group&&t.label===c.label) || ['voice','breath','synthesizer','vocal chops','vocal breath','vocal phrase','airy'].includes(c.label))))){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.disabled=busy;box.checked=labels[group].includes(c.label);label.title=c.description;box.addEventListener('change',()=>{const updated=structuredClone(labelsFor(item));updated[group]=box.checked?[...new Set([...updated[group],c.label])]:updated[group].filter(v=>v!==c.label);reviews[item.id]={labels:updated,confirmed:false,knownLabels:knownLabels()};persist();});label.append(box,document.createTextNode(' '+c.label));choices.append(label);}
 field.append(choices);el('categories').append(field);
 }
}
function render(){const item=manifest.items[current];if(!item){el('title').textContent='Add a sound to begin';el('categories').replaceChildren();updateProgress();return;}el('title').textContent=item.title;el('scope').textContent=`Clip ${current+1} of ${manifest.items.length} · ${item.folder} · ${item.songId ? `${item.startSeconds.toFixed(1)}–${(item.startSeconds+item.seconds).toFixed(1)}s of ${item.durationSeconds.toFixed(1)}s song` : `first ${item.seconds.toFixed(1)} seconds`}`;el('player').src=item.preview;el('picker').value=String(current);el('previous').disabled=current===0;el('hint').textContent=item.hintReasons.length?'Unconfirmed pack hints: '+item.hintReasons.join('; '):'No specific pack label available. Listen before choosing a category.';el('predictions').textContent=item.automaticTags.map(t=>`${t.label} (${t.model || 'model'})`).join(', ')||'No category passed the model thresholds.';renderInstrumentCandidates(item);el('saved').textContent=humanConfirmation(reviews[item.id])?'This clip’s labels are confirmed by you.':reviews[item.id]?.provenance==='assistant review'?'Assistant-reviewed using sample descriptions and model predictions; not listening-verified.':reviews[item.id]?.confirmed?'Unverified imported review. Listen and explicitly confirm before training.':'Awaiting your review.';renderPackSource(item);renderCategories();updateProgress();}
function renderPackSource(item){
 let section=el('pack-source');if(!section){section=document.createElement('p');section.id='pack-source';el('scope').after(section);}
 section.replaceChildren();if(!item.packSource)return;
 section.append(document.createTextNode('Pack: '+item.packSource.name+' · '+item.packSource.license+' · '));
 for(const [label,key] of [['Publisher','sourceUrl'],['License evidence','licenseUrl']]){
  try{const url=new URL(item.packSource[key]);if(url.protocol!=='https:'||url.username||url.password)continue;const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;section.append(link,document.createTextNode(' · '));}catch{ /* Omit invalid source links. */ }
 }
}
function populatePicker(){el('picker').replaceChildren();manifest.items.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=item.title;el('picker').append(option);});}
populatePicker();
el('picker').addEventListener('change',()=>{current=Number(el('picker').value);render();});
el('previous').addEventListener('click',()=>{current=Math.max(0,current-1);render();});
el('next').addEventListener('click',()=>{for(let offset=1;offset<=manifest.items.length;offset++){const index=(current+offset)%manifest.items.length;if(!humanConfirmation(reviews[manifest.items[index].id])){current=index;render();return;}}el('saved').textContent='All clips reviewed. Your confirmed examples are ready for Document Graph Explorer.';});
el('search').addEventListener('input',renderCategories);
el('suggestions').addEventListener('click',()=>{const item=manifest.items[current],labels=structuredClone(labelsFor(item));for(const t of item.automaticTags)if(groups.includes(t.group)&&!labels[t.group].includes(t.label))labels[t.group].push(t.label);reviews[item.id]={labels,confirmed:false,knownLabels:knownLabels()};persist();renderCategories();});
el('confirm').addEventListener('click',async()=>{
 if(busy)return;const item=manifest.items[current];if(!item)return;
 reviews[item.id]={labels:structuredClone(labelsFor(item)),confirmed:true,reviewedAt:new Date().toISOString(),provenance:'explicit human confirmation',knownLabels:knownLabels()};
 pendingReviewIds.add(item.id);saveLocal();updateProgress();
 el('saved').textContent='Confirmed. Updating Document Graph Explorer…';
 await applyReviews();
});
el('export').addEventListener('click',()=>{
 const nodes=manifest.items.map(item=>({id:'dj-review-'+item.id,title:item.title,path:item.preview,kind:'document',fileType:'audio',wordCount:0,topics:[],entities:[],keywords:[],degree:0,cluster:0,status:'ok',audio:{version:2,durationSeconds:item.seconds,analyzedSeconds:item.seconds,instruments:[],notes:['Labels and CLAP predictions cover only this excerpt.'],soundProfile:{version:1,character:[],roles:[],disagreement:false,models:[{model:'Music CLAP',complete:true,candidates:[]}],djTags:item.automaticTags},...(humanConfirmation(reviews[item.id])?{confirmedDjTags:reviews[item.id].labels}:{})}}));
 const reviewedCandidates=manifest.items.filter(i=>reviews[i.id]?.confirmed).map(i=>({id:'dj-review-'+i.id,originalPath:i.originalPath,preview:i.preview,labels:reviews[i.id].labels,embedding:i.embedding,reviewedAt:reviews[i.id].reviewedAt,provenance:reviews[i.id].provenance||'draft'}));
 const exportData={version:1,nodes,edges:[],djEvaluation:{scope:manifest.scope,reviewedBy:'See provenance on each training candidate',trainingExamples:reviewedCandidates.filter(candidate=>candidate.provenance==='explicit human confirmation'),reviewedCandidates,unreviewed:manifest.items.filter(i=>!reviews[i.id]?.confirmed).length}};
 const url=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dj-reviewed-collection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
});
render();

function setBusy(value){busy=value;for(const id of ['upload','audio-mode','add-category','apply','confirm','suggestions','refresh-sounds'])el(id).disabled=value;for(const box of document.querySelectorAll('#categories input'))box.disabled=value;}
async function waitJob(job){
 for(;;){
  const response=await fetch('/api/jobs/'+job.jobId,{cache:'no-store'});const result=await response.json();
  el('job-status').textContent=result.message||'Working…';
  if(result.state==='failed')throw Error(result.message);
  if(result.state==='complete')return result.result;
  await new Promise(resolve=>setTimeout(resolve,700));
 }
}
function fillSources(){el('category-source').replaceChildren(new Option('Unspecified',''));for(const c of catalog.categories.filter(c=>c.group==='source'))el('category-source').append(new Option(c.label,c.label));}
function showApplied(){
 el('applied').textContent=server.lastApplied?`Applied ${server.lastApplied.trainedExamples} reviewed clips; ${server.lastApplied.totalCategories} categories available. Reload Document Graph Explorer and reanalyze your audio. Packaged desktop copies need a separate rebuild.`:`${server.pendingCategories} new categories waiting to be applied.`;
 const report=server.lastApplied?.classifier;
 el('classifier-status').textContent=report?`${report.activeHeads} trained categories passed the provisional test checks. ${report.minimum}. ${report.note}`:'Each verification trains category classifiers when enough varied examples are available. Existing recognition stays available while you collect examples.';
 el('classifier-results').replaceChildren();
 for(const category of report?.categories||[]){
  if(!category.positives)continue;
  const row=document.createElement('p');
  row.textContent=`${category.key}: ${category.positives} clips with this sound, ${category.negatives} without. `+(category.status==='needs-examples'?'Needs more independent examples.':`${category.status==='active'?'Active':'Not enabled'} — test precision ${Math.round((category.precision||0)*100)}%, recall ${Math.round((category.recall||0)*100)}%, ${category.tested} test clips.`);
  el('classifier-results').append(row);
 }
}
async function refresh(){
 const selected=manifest.items[current]?.id;server=await (await fetch('/api/state',{cache:'no-store'})).json();manifest=server.manifest;catalog=server.catalog;
 // Fetch externally added reviews while preserving unsaved edits in this tab.
 const pending=Object.fromEntries([...pendingReviewIds].filter(id=>reviews[id]).map(id=>[id,reviews[id]]));
 reviews={...server.reviews,...pending};saveLocal();
 current=Math.max(0,manifest.items.findIndex(i=>i.id===selected));populatePicker();fillSources();showApplied();render();
}
el('refresh-sounds').addEventListener('click',async()=>{
 if(busy)return;setBusy(true);
 try{await saveQueue;await refresh();el('job-status').textContent=`Sound list updated: ${manifest.items.length} sounds available.`;}
 catch(error){el('job-status').textContent='Could not refresh the sound list: '+error.message;}
 finally{setBusy(false);}
});
el('category-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;setBusy(true);el('category-status').textContent='Adding category…';
 try{const result=await post('/api/categories',{label:el('category-name').value,group:el('category-group').value,source:el('category-source').value||null,description:el('category-description').value});await refresh();el('search').value=result.category.label;renderCategories();el('category-status').textContent='Added “'+result.category.label+'”. Select it below, then verify the clip to teach Document Graph Explorer.';el('category-form').reset();}
 catch(error){el('category-status').textContent=error.message;}finally{setBusy(false);}
});
el('upload').addEventListener('change',async()=>{
 if(busy)return;const files=[...el('upload').files];setBusy(true);
 try{for(const file of files){if(file.size>100*1024*1024)throw Error(file.name+' is over 100 MB.');el('job-status').textContent='Adding '+file.name;const result=await waitJob(await post('/api/sounds?name='+encodeURIComponent(file.name)+'&mode='+encodeURIComponent(el('audio-mode').value),file,true));await refresh();current=manifest.items.findIndex(i=>i.id===result.itemId);render();}el('job-status').textContent='Sounds added. Listen and confirm their labels.';}
 catch(error){el('job-status').textContent=error.message;}finally{setBusy(false);el('upload').value='';}
});
async function applyReviews(){
 if(busy)return;setBusy(true);
 try{
  el('job-status').textContent='Saving your reviews…';await saveQueue;
  // Save only edits from this tab; never overwrite newer external reviews.
  for(const id of [...pendingReviewIds])await saveReview(id);
  const result=await waitJob(await post('/api/apply',{}));await refresh();
  el('job-status').textContent=`Applied: ${result.trainedExamples} verified examples now teach Document Graph Explorer how to identify similar sounds. Reload Document Graph Explorer and reanalyze your audio.`;
  el('saved').textContent='Verification applied to the recognition model.';
 }catch(error){el('job-status').textContent='Model update failed: '+error.message+' Your browser copy is retained. Press Apply to Document Graph Explorer to retry.';el('saved').textContent='Verification has not been applied. Retry the model update.';}finally{setBusy(false);}
}
el('apply').addEventListener('click',applyReviews);
fillSources();showApplied();
// Preserve confirmations made in the earlier browser-only review page.
for(const item of manifest.items)if(local[item.id]&&!server.reviews[item.id]){pendingReviewIds.add(item.id);saveQueue=saveQueue.then(()=>saveReview(item.id)).catch(error=>{el('saved').textContent=error.message;});}

function renderInstrumentCandidates(item){
 let panel=el('instrument-candidates');if(!panel){panel=document.createElement('p');panel.id='instrument-candidates';el('predictions').after(panel);}
 const candidates=item.instrumentCandidates||[];
 panel.textContent=candidates.length ? 'Additional instrument evidence (model scores, not verified confidence): '+candidates.map(c=>`${c.label} (${c.model}): ${c.score.toFixed(2)}`).join('; ')+'. Low-scoring possibilities are not selected automatically.' : '';
}
