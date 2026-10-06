import { test, expect } from '@playwright/test';
import { correctDjTags } from './sampleAssistant';
import { dismissGuide, fitAll, hideDetails, importGraphJson, openExport, switchDims } from './resonance';

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
 // Software WebGL on shared CI runners can hold the main thread well past 15s
 // while the graph scene rebuilds, so plain clicks get the same budget.
 page.setDefaultTimeout(60_000);
 const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
 // Start from the 3D scene (a fresh profile opens the flat map) so both views are exercised.
 await page.addInitScript(()=>localStorage.setItem('knowledge-nebula-dims','3'));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/');
 const importFixture=async(contents:string)=>{
  await importGraphJson(page,contents,'audio-graph.json');
  await expect(page.getByRole('button',{name:'Search documents'})).toBeEnabled();
  await dismissGuide(page);
 };
 const openAlpha=async()=>{
  await page.getByRole('button',{name:'Search documents'}).click();
  await page.getByRole('option',{name:/Alpha piano/}).click();
  await expect(page.locator('.audio-preview')).toBeVisible();
  await page.getByRole('button',{name:'Connections',exact:true}).click();
 };
 const exportGraph=async()=>{
  await openExport(page);
  const promise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export graph JSON',exact:true}).click();
  const download=await promise; const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk;
  return text;
 };
 // Drag across the middle of the graph stage and zoom with the wheel.
 const panAndZoom=async(wheel:number)=>{
  const stage=(await page.locator('.nebula-canvas canvas').boundingBox())!;
  const x=stage.x+stage.width/2, y=stage.y+stage.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y+50,{steps:10});await page.mouse.up();
  if(wheel)await page.mouse.wheel(0,wheel);
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
 await switchDims(page,2);
 await fitAll(page);
 await panAndZoom(-120);
 await fitAll(page);
 await page.screenshot({path:testInfo.outputPath('audio-graph-desktop.png')});
 // The similarity filter lists the link kinds the graph contains. Its native
 // checkbox sits behind a drawn control, so toggle it through the label.
 const filters=page.getByRole('complementary',{name:'Filters'});
 const soundFilter=filters.getByRole('checkbox',{name:'Sound properties',exact:true});
 const soundLabel=filters.locator('label',{hasText:'Sound properties'});
 await soundLabel.click();
 await expect(soundFilter).toBeChecked();
 await soundLabel.click();
 await expect(soundFilter).not.toBeChecked();
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
 await expect(page.locator('.rs-root')).toBeVisible();
 const reexported=JSON.parse(await exportGraph());
 expect(reexported.edges).toEqual(updated.edges);
 expect(reexported.nodes.find((n:{id:string})=>n.id==='alpha').audio.confirmedDjTags.character).toEqual([]);
 await switchDims(page,3);
 await fitAll(page);
 await panAndZoom(120);
 await openAlpha();
 await hideDetails(page);
 await panAndZoom(0);
 await openAlpha();
 expect(errors).toEqual([]);
});
