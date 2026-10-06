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
const labelKey=c=>c.group+':'+c.label;
const selectedKeys=labels=>groups.flatMap(group=>(labels[group]||[]).map(label=>group+':'+label));
const reviewedKeys=(labels,decisions={})=>[...new Set([...selectedKeys(labels),...Object.keys(decisions).filter(key=>decisions[key]==='absent')])];
function draftReview(item,labels,decisions=reviews[item.id]?.decisions||{}){
 return {labels,decisions,confirmed:false,knownLabels:reviewedKeys(labels,decisions),reviewStatus:'pending'};
}
const queueMatches=item=>el('queue').value==='all'||(el('queue').value==='confirmed'?humanConfirmation(reviews[item.id]):el('queue').value==='uncertain'?reviews[item.id]?.reviewStatus==='uncertain':!humanConfirmation(reviews[item.id]));

const humanConfirmation=review=>review?.confirmed===true&&review.provenance==='explicit human confirmation';
async function post(path,data,raw=false){
 const response=await fetch(path,{method:'POST',headers:{'X-Review-Token':server.token,...(raw?{}:{'Content-Type':'application/json'})},body:raw?data:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save changes.');return result;
}
async function saveReview(id){
 const review=reviews[id];if(!review)return;
 if(!review.knownLabels)review.knownLabels=reviewedKeys(review.labels,review.decisions);
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
 const item=manifest.items[current];el('categories').replaceChildren();if(!item)return;
 const labels=labelsFor(item),query=el('search').value.trim().toLowerCase(),decisions=reviews[item.id]?.decisions||{};
 const visible=c=>{
  const selected=labels[c.group].includes(c.label);
  if(selected)return true;
  if(el('family').value&&c.family!==el('family').value)return false;
  if(query&&![c.label,c.family,...(c.aliases||[])].some(text=>text.toLowerCase().includes(query)))return false;
  if(el('label-view').value==='selected')return false;
  return el('label-view').value!=='suggested'||item.automaticTags.some(t=>t.group===c.group&&t.label===c.label);
 };
 const available=catalog.categories.filter(visible);
 el('label-count').textContent=`${available.length} of ${catalog.categories.length} labels shown · ${selectedKeys(labels).length} present · ${Object.values(decisions).filter(v=>v==='absent').length} explicitly absent`;
 for(const group of groups){
  const field=document.createElement('fieldset'),legend=document.createElement('legend');
  legend.textContent=(group==='production'?'Production type':group[0].toUpperCase()+group.slice(1))+` (${available.filter(c=>c.group===group).length})`;
  field.append(legend);const choices=document.createElement('div');choices.className='choices';
  for(const c of available.filter(c=>c.group===group)){
   const row=document.createElement('div');row.className='label-row';const label=document.createElement('label'),box=document.createElement('input'),decision=document.createElement('select');
   const key=labelKey(c);box.type='checkbox';box.disabled=busy;box.checked=labels[group].includes(c.label);label.title=c.description;
   box.addEventListener('change',()=>{
    const updated=structuredClone(labelsFor(item)),nextDecisions={...(reviews[item.id]?.decisions||{})};
    updated[group]=box.checked?[...new Set([...updated[group],c.label])]:updated[group].filter(v=>v!==c.label);
    delete nextDecisions[key];reviews[item.id]=draftReview(item,updated,nextDecisions);persist();renderCategories();
   });
   decision.setAttribute('aria-label','Review status for '+c.label);decision.dataset.labelKey=key;
   for(const [value,text] of [['','Not reviewed'],['absent','Absent'],['unsure','Unsure']])decision.append(new Option(text,value));
   if(box.checked)decision.append(new Option('Present','present'));decision.value=box.checked?'present':decisions[key]||'';decision.disabled=busy||box.checked;
   decision.addEventListener('change',()=>{
    const nextDecisions={...(reviews[item.id]?.decisions||{})};if(decision.value)nextDecisions[key]=decision.value;else delete nextDecisions[key];
    reviews[item.id]=draftReview(item,structuredClone(labelsFor(item)),nextDecisions);persist();renderCategories();
   });
   label.append(box,document.createTextNode(' '+c.label));row.append(label,decision);choices.append(row);
  }
  field.append(choices);el('categories').append(field);
 }
}
function renderProperties(item){
 const values=[`Reviewed excerpt: ${item.seconds.toFixed(2)} seconds`],p=item.properties;
 if(p){if(Number.isFinite(p.rmsDbfs))values.push(`RMS level: ${p.rmsDbfs.toFixed(1)} dBFS`);if(Number.isFinite(p.peakDbfs))values.push(`Peak: ${p.peakDbfs.toFixed(1)} dBFS`);if(Number.isFinite(p.zeroCrossingRate))values.push(`Zero-crossing rate: ${p.zeroCrossingRate.toFixed(4)}`);}
 el('properties').textContent=values.join(' · ')+(p?' · measured on decoded mono excerpt':' · other measurements unavailable for this older clip');
}

function render(){const item=manifest.items[current];if(!item){el('title').textContent=manifest.items.length?'No clips in this queue':'Add a sound to begin';for(const id of ['confirm','set-aside','suggestions','previous','next','picker'])el(id).disabled=true;el('categories').replaceChildren();el('player').removeAttribute('src');el('properties').textContent='';el('label-count').textContent=`${catalog.categories.length} catalog labels available after adding a clip`;updateProgress();return;}for(const id of ['confirm','set-aside','suggestions','next','picker'])el(id).disabled=busy;el('title').textContent=item.title;el('scope').textContent=`Clip ${current+1} of ${manifest.items.length} · ${item.folder} · ${item.songId ? `${item.startSeconds.toFixed(1)}–${(item.startSeconds+item.seconds).toFixed(1)}s of ${item.durationSeconds.toFixed(1)}s song` : `first ${item.seconds.toFixed(1)} seconds`}`;el('player').src=item.preview;el('picker').value=String(current);el('previous').disabled=current===0;el('hint').textContent=item.hintReasons.length?'Unconfirmed pack hints: '+item.hintReasons.join('; '):'No specific pack label available. Listen before choosing a category.';el('predictions').textContent=item.automaticTags.map(t=>`${t.label} (${t.model || 'model'})`).join(', ')||'No category passed the model thresholds.';renderInstrumentCandidates(item);el('saved').textContent=humanConfirmation(reviews[item.id])?'This clip’s labels are confirmed by you.':reviews[item.id]?.reviewStatus==='uncertain'?'Set aside as unsure. Excluded from training until confirmed.':reviews[item.id]?.provenance==='assistant review'?'Assistant-reviewed using sample descriptions and model predictions; not listening-verified.':reviews[item.id]?.confirmed?'Unverified imported review. Listen and explicitly confirm before training.':'Awaiting your review.';renderPackSource(item);renderProperties(item);renderCategories();updateProgress();}
function renderPackSource(item){
 let section=el('pack-source');if(!section){section=document.createElement('p');section.id='pack-source';el('scope').after(section);}
 section.replaceChildren();if(!item.packSource)return;
 section.append(document.createTextNode('Pack: '+item.packSource.name+' · '+item.packSource.license+' · '));
 for(const [label,key] of [['Publisher','sourceUrl'],['License evidence','licenseUrl']]){
  try{const url=new URL(item.packSource[key]);if(url.protocol!=='https:'||url.username||url.password)continue;const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;section.append(link,document.createTextNode(' · '));}catch{ /* Omit invalid source links. */ }
 }
}
function populatePicker(){el('picker').replaceChildren();const count=manifest.items.filter(queueMatches).length;el('queue-status').textContent=`${count} clips in this queue`;manifest.items.forEach((item,index)=>{if(!queueMatches(item))return;const option=document.createElement('option');option.value=String(index);option.textContent=item.title;el('picker').append(option);});}
populatePicker();
el('picker').addEventListener('change',()=>{current=Number(el('picker').value);render();});
el('previous').addEventListener('click',()=>{const previous=manifest.items.map((item,index)=>({item,index})).filter(({item,index})=>index<current&&queueMatches(item)).at(-1);if(previous){current=previous.index;render();}});
el('next').addEventListener('click',()=>{for(let offset=1;offset<=manifest.items.length;offset++){const index=(current+offset)%manifest.items.length;if(queueMatches(manifest.items[index])&&!humanConfirmation(reviews[manifest.items[index].id])){current=index;render();return;}}el('saved').textContent='All clips reviewed. Your confirmed examples are ready for Document Graph Explorer.';});
el('search').addEventListener('input',renderCategories);
el('label-view').addEventListener('change',renderCategories);el('family').addEventListener('change',renderCategories);
el('queue').addEventListener('change',()=>{populatePicker();const first=manifest.items.findIndex(queueMatches);current=first;render();if(first<0)el('saved').textContent='No clips in this queue. Choose another queue.';});
el('set-aside').addEventListener('click',()=>{if(busy)return;const item=manifest.items[current];if(!item)return;reviews[item.id]={...draftReview(item,structuredClone(labelsFor(item))),reviewStatus:'uncertain'};persist();populatePicker();el('saved').textContent='Set aside. This clip is excluded from training until you confirm it.';});

el('suggestions').addEventListener('click',()=>{const item=manifest.items[current];if(!item)return;const labels=structuredClone(labelsFor(item));for(const t of item.automaticTags)if(groups.includes(t.group)&&!labels[t.group].includes(t.label))labels[t.group].push(t.label);const decisions={...(reviews[item.id]?.decisions||{})};for(const key of selectedKeys(labels))delete decisions[key];reviews[item.id]=draftReview(item,labels,decisions);persist();renderCategories();});
el('confirm').addEventListener('click',async()=>{
 if(busy)return;const item=manifest.items[current];if(!item)return;
 reviews[item.id]={...draftReview(item,structuredClone(labelsFor(item))),confirmed:true,reviewStatus:'confirmed',reviewedAt:new Date().toISOString(),provenance:'explicit human confirmation'};
 pendingReviewIds.add(item.id);saveLocal();updateProgress();
 el('saved').textContent='Confirmed. Updating Document Graph Explorer…';
 await applyReviews();
});
el('export').addEventListener('click',()=>{
 const nodes=manifest.items.map(item=>({id:'dj-review-'+item.id,title:item.title,path:item.preview,kind:'document',fileType:'audio',wordCount:0,topics:[],entities:[],keywords:[],degree:0,cluster:0,status:'ok',audio:{version:2,durationSeconds:item.seconds,analyzedSeconds:item.seconds,instruments:[],notes:['Labels and CLAP predictions cover only this excerpt.'],soundProfile:{version:1,character:[],roles:[],disagreement:false,models:[{model:'Music CLAP',complete:true,candidates:[]}],djTags:item.automaticTags},...(humanConfirmation(reviews[item.id])?{confirmedDjTags:reviews[item.id].labels}:{})}}));
 const reviewedCandidates=manifest.items.filter(i=>reviews[i.id]?.confirmed).map(i=>({id:'dj-review-'+i.id,originalPath:i.originalPath,preview:i.preview,labels:reviews[i.id].labels,knownLabels:reviews[i.id].knownLabels||selectedKeys(reviews[i.id].labels),embedding:i.embedding,reviewedAt:reviews[i.id].reviewedAt,provenance:reviews[i.id].provenance||'draft'}));
 const exportData={version:1,nodes,edges:[],djEvaluation:{scope:manifest.scope,reviewedBy:'See provenance on each training candidate',trainingExamples:reviewedCandidates.filter(candidate=>candidate.provenance==='explicit human confirmation'),reviewedCandidates,unreviewed:manifest.items.filter(i=>!humanConfirmation(reviews[i.id])).length}};
 const url=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dj-reviewed-collection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
});
function trainingDataset(){
 const examples=manifest.items.filter(item=>humanConfirmation(reviews[item.id])).map(item=>{
  const review=reviews[item.id],present=selectedKeys(review.labels),assessed=review.knownLabels||present;
  return {id:item.id,title:item.title,originalPath:item.originalPath,preview:item.preview,scope:{startSeconds:item.startSeconds||0,seconds:item.seconds},labels:review.labels,knownLabels:assessed,absentLabels:assessed.filter(key=>!present.includes(key)),uncertainLabels:Object.keys(review.decisions||{}).filter(key=>review.decisions[key]==='unsure'),properties:item.properties||{durationSeconds:item.seconds},embedding:item.embedding,reviewedAt:review.reviewedAt,provenance:review.provenance,recordingGroup:item.songId||item.originalPath||item.id,packSource:item.packSource||null};
 });
 return {schema:'dge-sound-training-v1',exportedAt:new Date().toISOString(),catalog:{categories:catalog.categories},labelPolicy:'Only explicit human confirmations are exported. Unreviewed and unsure labels are unknown, not negative. Keep recording and sample-pack families together when splitting datasets.',examples,excludedClips:manifest.items.length-examples.length};
}
el('export-training').addEventListener('click',()=>{
 const data=trainingDataset();if(!data.examples.length){el('saved').textContent='Confirm at least one clip before exporting training data.';return;}
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dge-sound-training.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 el('saved').textContent=`Exported ${data.examples.length} confirmed clips with the full ${catalog.categories.length}-label catalog.`;
});
render();

function setBusy(value){busy=value;for(const id of ['upload','upload-folder','picker','queue','previous','next','set-aside','audio-mode','add-category','apply','confirm','suggestions','refresh-sounds'])el(id).disabled=value;for(const box of document.querySelectorAll('#categories input,#categories select'))box.disabled=value||(box.tagName==='SELECT'&&box.closest('.label-row').querySelector('input').checked);if(!value){for(const id of ['confirm','set-aside','suggestions','previous','next','picker'])if(!manifest.items[current])el(id).disabled=true;el('previous').disabled=current<=0;}}
async function waitJob(job){
 for(;;){
  const response=await fetch('/api/jobs/'+job.jobId,{cache:'no-store'});const result=await response.json();
  el('job-status').textContent=result.message||'Working…';
  if(result.state==='failed')throw Error(result.message);
  if(result.state==='complete')return result.result;
  await new Promise(resolve=>setTimeout(resolve,700));
 }
}
function fillSources(){const family=el('family').value;el('family').replaceChildren(new Option('All families',''));for(const value of [...new Set(catalog.categories.map(c=>c.family))].sort())el('family').append(new Option(value.replaceAll('-',' '),value));el('family').value=family;el('category-source').replaceChildren(new Option('Unspecified',''));for(const c of catalog.categories.filter(c=>c.group==='source'))el('category-source').append(new Option(c.label,c.label));}
function showApplied(){
 el('applied').textContent=server.lastApplied?`Applied ${server.lastApplied.trainedExamples} reviewed clips; ${server.lastApplied.totalCategories} categories available. Reload Document Graph Explorer and reanalyze your audio. Packaged desktop copies need a separate rebuild.`:`${server.pendingCategories} new categories waiting to be applied.`;
 const report=server.lastApplied?.classifier;
 el('classifier-status').textContent=report?`${report.activeHeads} trained categories passed the provisional test checks. ${report.minimum}. ${report.note}`:'Each verification trains category classifiers when enough varied examples are available. Existing recognition stays available while you collect examples.';
 el('classifier-results').replaceChildren();
 for(const c of catalog.categories){
  const category=report?.categories?.find(result=>result.key===labelKey(c))||{key:labelKey(c),positives:0,negatives:0,status:'needs-examples'};
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
 const selectedIndex=manifest.items.findIndex(i=>i.id===selected);current=selectedIndex>=0&&queueMatches(manifest.items[selectedIndex])?selectedIndex:manifest.items.findIndex(queueMatches);populatePicker();fillSources();showApplied();render();
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
async function uploadFiles(input){
 if(busy)return;const files=[...input.files].filter(file=>/\.(wav|mp3|ogg|flac|aiff|m4a)$/i.test(file.name));setBusy(true);let added=0;const failures=[];
 try{for(const [index,file] of files.entries()){
  try{if(file.size>100*1024*1024)throw Error('over 100 MB');el('job-status').textContent=`Adding ${index+1} of ${files.length}: ${file.name}`;
   const result=await waitJob(await post('/api/sounds?name='+encodeURIComponent(file.name)+'&mode='+encodeURIComponent(el('audio-mode').value),file,true));await refresh();el('queue').value='all';populatePicker();current=Math.max(0,manifest.items.findIndex(i=>i.id===result.itemId));render();added++;
  }catch(error){failures.push(file.name+': '+error.message);}
 }el('job-status').textContent=`${added} of ${files.length} audio files added. Listen and confirm their labels.`+(failures.length?' Failed: '+failures.join('; '):'');
 }finally{setBusy(false);input.value='';}
}
el('upload').addEventListener('change',()=>uploadFiles(el('upload')));
el('upload-folder').addEventListener('change',()=>uploadFiles(el('upload-folder')));

async function applyReviews(){
 if(busy)return;setBusy(true);
 try{
  el('job-status').textContent='Saving your reviews…';await saveQueue;
  // Save only edits from this tab; never overwrite newer external reviews.
  for(const id of [...pendingReviewIds])await saveReview(id);
  const result=await waitJob(await post('/api/apply',{}));await refresh();
  el('job-status').textContent=result.skipped?'Verification saved. '+result.skipped:`Applied: ${result.trainedExamples} verified examples now teach Document Graph Explorer how to identify similar sounds. Reload Document Graph Explorer and reanalyze your audio.`;
  el('saved').textContent=result.skipped?'Verification saved. '+result.skipped:'Verification applied to the recognition model.';
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
