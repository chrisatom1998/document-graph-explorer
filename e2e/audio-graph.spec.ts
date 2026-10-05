import { test, expect } from '@playwright/test';
import { correctDjTags } from './sampleAssistant';

const base = { kind:'document',fileType:'audio',topics:[],entities:[],keywords:[],wordCount:0,degree:0,cluster:0,status:'ok' };
const analysis = {version:2,analyzedSeconds:8,durationSeconds:8,instruments:[],notes:[]};
const fixture = JSON.stringify({version:1,generator:'knowledge-nebula',createdAt:'2026-10-04T00:00:00Z',includeEmbeddings:false,nodes:[
 { ...base,id:'alpha',title:'Alpha piano',audio:{...analysis,tempo:{bpm:120,confidence:.9},key:{tonic:0,mode:'major',strength:.9},confirmedDjTags:{source:['piano'],production:['riser'],character:['metallic']}}},
 { ...base,id:'beta',title:'Beta piano',audio:{...analysis,tempo:{bpm:121,confidence:.9},key:{tonic:9,mode:'minor',strength:.9},confirmedDjTags:{source:['piano'],production:['riser'],character:['metallic']}}},
 { ...base,id:'half',title:'Half pulse',audio:{...analysis,tempo:{bpm:60,confidence:.9}}},
 { ...base,id:'unknown',title:'Unknown sound',audio:analysis},
 { ...base,id:'rejected',title:'Reviewed sound',audio:{...analysis,confirmedDjTags:{source:[],production:[],character:['metallic']},soundReviews:[{dimension:'character',labelId:'metallic',decision:'uncertain',scope:'track',at:'2026-10-04T00:00:00Z',evidenceRunId:'r'}]}},
 { ...base,id:'notes',title:'Recording notes',fileType:'txt'},
],edges:[{id:'notes-link',source:'alpha',target:'notes',kind:'reference',weight:1,evidence:['Session notes'],authored:true}]});

test('automatic audio graph explains matches, updates corrections, exports, and works on desktop/mobile', async ({page},testInfo)=>{
 page.setDefaultTimeout(15000);
 const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('knowledge-nebula-theme','dark'));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/');
 const importFixture=async(contents:string)=>{
  await page.getByRole('button',{name:'Import a graph',exact:true}).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate((element,contents)=>{
   const transfer=new DataTransfer();transfer.items.add(new File([contents],'audio-graph.json',{type:'application/json'}));
   Object.defineProperty(element,'files',{configurable:true,value:transfer.files});element.dispatchEvent(new Event('change',{bubbles:true}));
  },contents);
  await expect(page.getByRole('button',{name:'Search documents'})).toBeEnabled();
  const guide=page.getByRole('button',{name:'Dismiss getting started'});if(await guide.isVisible())await guide.click();
 };
 const openAlpha=async()=>{
  await page.getByRole('button',{name:'Search documents'}).click();
  await page.getByRole('option',{name:/Alpha piano/}).click();
  await expect(page.locator('.audio-preview')).toBeVisible();
  await page.getByRole('button',{name:'Connections',exact:true}).click();
 };
 const exportGraph=async()=>{
  await page.getByRole('button',{name:'Data options',exact:true}).click();
  const promise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export graph JSON',exact:true}).click();
  const download=await promise; const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk;
  return text;
 };
 // Toasts auto-dismiss on a timer, so a count-then-click loop races a toast that vanishes between the two calls
 // (click then waits 15s for a button that never returns). Click whatever is up now, then wait for the stack to empty.
 const dismissToasts=async()=>{
  const dismiss=page.getByRole('button',{name:'Dismiss notification',exact:true});
  for(const button of await dismiss.all())await button.click({timeout:2000}).catch(()=>{});
  await expect(dismiss).toHaveCount(0);
 };
 await importFixture(fixture);
 // The first scene builds right after import; under software WebGL that can hold the main thread past the 15s default.
 await page.getByRole('button',{name:'Switch to 2D view',exact:true}).click({timeout:60_000});
 await expect(page.getByRole('application',{name:/Interactive 2D/})).toBeVisible();
 await page.getByRole('button',{name:'Fit the whole graph in view'}).click();
 await page.mouse.move(500,300);await page.mouse.down();await page.mouse.move(570,350,{steps:10});await page.mouse.up();await page.mouse.wheel(0,-120);
 await page.getByRole('button',{name:'Fit the whole graph in view'}).click();
 await page.screenshot({path:testInfo.outputPath('audio-graph-desktop.png')});
 await page.getByRole('button',{name:'Show graph filters',exact:true}).click();
 await page.getByRole('button',{name:'More filters',exact:true}).click();
 await page.getByRole('button',{name:'sound properties',exact:true}).click();
 await expect(page.getByRole('button',{name:'sound properties',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'sound properties',exact:true}).click();
 await page.getByRole('button',{name:'Hide graph filters',exact:true}).click();
 await openAlpha();
 await expect(page.locator('.connection-row__evidence')).toContainText(['Shared instruments: piano']);
 const showAll=page.getByRole('button',{name:/Show all \d+ connections/});if(await showAll.isVisible())await showAll.click();
 await expect(page.locator('.side-panel')).toContainText('Half/double-time tempo');
 await expect(page.locator('.side-panel')).toContainText('Shared sound properties');
 await dismissToasts();
 await page.locator('.connection-row').filter({hasText:'Shared sound properties'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath('audio-match-reasons-desktop.png')});
 const exported=await exportGraph(); const graph=JSON.parse(exported);
 expect(graph.edges.some((e:{kind:string})=>e.kind==='sound')).toBe(true);
 expect(graph.edges.some((e:{id:string})=>e.id==='notes-link')).toBe(true);
 expect(graph.edges.some((e:{source:string;target:string})=>[e.source,e.target].some(id=>['unknown','rejected'].includes(id)))).toBe(false);
 await page.setViewportSize({width:390,height:844});
 await dismissToasts();
 await page.locator('.connection-row').filter({hasText:'Shared sound properties'}).scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:testInfo.outputPath('audio-match-reasons-mobile.png')});
 await page.setViewportSize({width:1440,height:1000});
 // Change a reviewed label through the real editor and verify derived edges update.
 await correctDjTags(page,'Alpha piano',async card=>{
  await card.getByRole('checkbox',{name:'metallic',exact:true}).uncheck();
  await card.getByRole('checkbox',{name:'riser',exact:true}).uncheck();
 },'Tags updated. Export this graph to keep the changes.');
 const corrected=await exportGraph(); const updated=JSON.parse(corrected);
 expect(updated.edges.some((e:{kind:string})=>e.kind==='sound')).toBe(false);
 expect(updated.edges.some((e:{kind:string})=>e.kind==='instrument')).toBe(true);
 // Imported graphs are intentionally ephemeral; reimport the exported correction after reload.
 await page.reload(); await importFixture(corrected);
 await expect(page.locator('html')).toHaveAttribute('data-theme','glass-dark');
 const reexported=JSON.parse(await exportGraph());
 expect(reexported.edges).toEqual(updated.edges);
 expect(reexported.nodes.find((n:{id:string})=>n.id==='alpha').audio.confirmedDjTags.character).toEqual([]);
 // Building the 3D scene under software WebGL can hold the main thread past the 15s default.
 await page.getByRole('button',{name:'Switch to 3D view',exact:true}).click({timeout:60_000});
 await expect(page.getByRole('application',{name:/Interactive 3D/})).toBeVisible();
 await page.getByRole('button',{name:'Fit the whole graph in view'}).click();
 await page.mouse.move(500,300);await page.mouse.down();await page.mouse.move(570,350,{steps:10});await page.mouse.up();await page.mouse.wheel(0,120);
 await openAlpha();
 await page.getByRole('button',{name:'Back to graph',exact:true}).click();
 await page.mouse.move(500,300);await page.mouse.down();await page.mouse.move(570,350,{steps:10});await page.mouse.up();
 await openAlpha();
 expect(errors).toEqual([]);
});
